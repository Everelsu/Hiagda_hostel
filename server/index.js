require("./env").loadEnv()

const path = require("node:path")
const fs = require("node:fs")
const crypto = require("node:crypto")
const http = require("node:http")
const express = require("express")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const multer = require("multer")
const ExcelJS = require("exceljs")

const db = require("./db")
const push = require("./push")
const { sign, authenticate, requireRole, requireStaff, requireRepair, canRepair } = require("./auth")
const { createRealtimeServer, STAFF_ROLES } = require("./realtime")
const { detectColumns, isFio, titleCase } = require("./residents-import")
const backups = require("./backups")
const storage = require("./storage")

let realtime = null
const broadcast = (type, payload, canReceive) => realtime?.broadcast(type, payload, canReceive)
const broadcastToStaff = (type, payload) => realtime?.staff(type, payload)
const roomHotelId = async (roomId) => (await db.prepare("SELECT hotel_id FROM rooms WHERE id = ?").get(roomId))?.hotel_id
const bedHotelId = async (bedId) => (await db.prepare("SELECT r.hotel_id FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?").get(bedId))?.hotel_id

// Даты живут строками «ГГГГ-ММ-ДД» и считаются по местному времени сервера.
// toISOString() отдаёт UTC: восточнее Гринвича «сегодня» до полудня уезжало на день назад,
// из-за чего дашборд, карта и графики показывали вчерашний день.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const todayStr = () => ymd(new Date())
const addDays = (date, n) => {
	const [y, m, d] = String(date).split("-").map(Number)
	return ymd(new Date(y, m - 1, d + n))
}
// Период брони полуоткрытый: ночи с date_from по date_to − 1. В день выезда место уже свободно.
const nights = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000)

const STAGES = ["expected", "checked_in", "checked_out", "cancelled"]
const STAGE_TRANSITIONS = {
	expected: ["checked_in", "cancelled"],
	checked_in: ["checked_out", "cancelled"],
	checked_out: ["checked_in"],
	cancelled: ["expected"],
}
const canTransition = (from, to) => from === to || STAGE_TRANSITIONS[from]?.includes(to)
const STAGE_LABELS = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
const stageLabel = (stage) => STAGE_LABELS[stage] || STAGE_LABELS.expected
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, resident_id: u.resident_id ?? null, must_change_password: !!u.must_change_password })
const ISSUE_STATUSES = ["Новая", "В работе", "Починено"]
const MIN_PASSWORD = 6
// Системные статусы (Свободно / Ремонт) — это производные состояния, а не бронь.
// «Свободно» = брони нет, «Ремонт» = room_blocks. Назначать их человеку нельзя.
const systemStatus = async (id) => await db.prepare("SELECT name, code FROM statuses WHERE id = ? AND kind = 'system'").get(id)
const SYSTEM_STATUS_ERROR = {
	free: "«Свободно» — это отсутствие брони, такой статус не назначается. Выберите статус брони.",
	repair: "«Ремонт» ставится на номер целиком (протяжка в календаре броней → «Поставить на ремонт»), а не бронью на человека.",
}
const systemStatusError = (st) => SYSTEM_STATUS_ERROR[st.code] || `Статус «${st.name}» системный и не назначается броням.`
const weakPassword = (p) => !p || String(p).length < MIN_PASSWORD
const imagesFor = async (ownerType, ownerId) =>
	await db.prepare("SELECT id, url FROM images WHERE owner_type = ? AND owner_id = ? ORDER BY sort, id").all(ownerType, ownerId)

const CYRILLIC_TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" }
const translit = (s) => (s || "").toLowerCase().split("").map((c) => (c in CYRILLIC_TRANSLIT ? CYRILLIC_TRANSLIT[c] : c)).join("").replace(/[^a-z0-9]/g, "")

// ── Учётные данные вахтовика ─────────────────────────────────────────────────
// Логин собирается из фамилии и инициалов: «ivanov.ii». Табельный номер логином
// не делаем — восьмизначное число человек диктует и вводит с ошибками, а при входе
// его всё равно не с чем сверить. Фамилия узнаваема и остаётся стабильной.
// Порядок разрешения конфликтов: ivanov.ii → ivanov.ii2 → ivanov.ii3 …
function usernameBase(resident) {
	const parts = String(resident.full_name || "").trim().split(/\s+/).filter(Boolean)
	const surname = translit(parts[0] || "")
	const initials = parts.slice(1, 3).map((p) => translit(p).slice(0, 1)).join("")
	let base = initials ? `${surname}.${initials}` : surname
	// Запасные варианты, если ФИО пустое или записано латиницей без кириллицы
	if (!surname) base = translit(resident.tab_number || "") || "user"
	// Логин не должен начинаться с цифры: иначе его легко спутать с табельным номером
	if (/^[0-9]/.test(base)) base = `v${base}`
	return base.slice(0, 20)
}

async function genUsername(resident, conn = db) {
	const base = usernameBase(resident)
	let candidate = base
	for (let i = 2; i < 1000; i++) {
		if (!(await conn.prepare("SELECT 1 FROM users WHERE username = ?").get(candidate))) return candidate
		candidate = `${base}${i}`
	}
	// Вырожденный случай (тысяча однофамильцев с одинаковыми инициалами) —
	// добиваем случайным хвостом, лишь бы выдача учётки не сорвалась.
	return `${base}.${crypto.randomBytes(3).toString("hex")}`
}

// Временный пароль на первый вход: его всё равно придётся сменить
// (must_change_password = 1), но продиктовать по телефону он должен легко.
// Слоги «согласная + гласная» читаются вслух однозначно, ambiguous-символы
// (0/o, 1/l/i) исключены полностью. 4 слога + 2 цифры ≈ 10^10 вариантов.
const PWD_CONSONANTS = "bcdfghkmnprstvxz"
const PWD_VOWELS = "aeiou"
function genPassword() {
	let p = ""
	for (let i = 0; i < 4; i++) {
		p += PWD_CONSONANTS[crypto.randomInt(PWD_CONSONANTS.length)]
		p += PWD_VOWELS[crypto.randomInt(PWD_VOWELS.length)]
	}
	// Math.random() предсказуем и для паролей непригоден — только crypto.
	p += String(crypto.randomInt(10, 100))
	return p
}

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage() })

// UPLOADS_DIR — для тестов: уборка в них не должна видеть настоящие фото с диска
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "..", "data", "uploads")
fs.mkdirSync(uploadsDir, { recursive: true })
const IMAGE_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" }
const uploadImage = multer({
	storage: multer.diskStorage({
		destination: uploadsDir,
		filename: (_req, file, cb) => {
			const ext = IMAGE_MIME[file.mimetype] || path.extname(file.originalname) || ".bin"
			cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
		},
	}),
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_MIME),
})

const api = express.Router()

// Express 4 не умеет ловить отказы промисов из async-обработчиков: сбой в запросе
// к БД прошёл бы мимо обработчика ошибок, оставив запрос висеть, а процесс — с
// unhandledRejection. Оборачиваем каждый обработчик один раз здесь, чтобы не
// расставлять try/catch по сотне маршрутов.
const wrapAsync = (fn) =>
	function (req, res, next) {
		Promise.resolve(fn.call(this, req, res, next)).catch(next)
	}
for (const method of ["get", "post", "put", "patch", "delete", "all", "use"]) {
	const original = api[method].bind(api)
	// length === 4 — это обработчик ошибок (err, req, res, next), его не трогаем
	api[method] = (...args) => original(...args.map((a) => (typeof a === "function" && a.length < 4 ? wrapAsync(a) : a)))
}

api.get("/setup-status", async (_req, res) => {
	const count = (await db.prepare("SELECT COUNT(*) c FROM users").get()).c
	res.json({ needsSetup: count === 0 })
})

api.post("/register-admin", async (req, res) => {
	if ((await db.prepare("SELECT COUNT(*) c FROM users").get()).c > 0) {
		return res.status(403).json({ error: "Администратор уже создан" })
	}
	const { username, password, full_name } = req.body || {}
	if (!username) return res.status(400).json({ error: "Укажите логин" })
	if (weakPassword(password)) return res.status(400).json({ error: `Пароль слишком короткий (мин. ${MIN_PASSWORD} символов)` })
	const info = await db
		.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,'admin')")
		.run(username, bcrypt.hashSync(password, 10), full_name || null)
	const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid)
	res.json({ token: sign(user), user: publicUser(user) })
})

// Настройки для браузера до входа. Ключ JS API Яндекса в любом случае виден в коде
// страницы, поэтому отдаём его открыто (ограничение — по HTTP Referer в кабинете Яндекса).
// Для автообновления и мониторинга: жив ли сервер, отвечает ли база, какая версия
api.get("/health", async (_req, res) => {
	try {
		await db.prepare("SELECT 1 AS ok").get()
		res.json({ ok: true, version: process.env.APP_VERSION || "dev" })
	} catch (e) {
		res.status(503).json({ ok: false, error: "база недоступна" })
	}
})

api.get("/public-config", (_req, res) => res.json({ yandexMapsKey: process.env.YANDEX_MAPS_KEY || null }))

api.post("/login", async (req, res) => {
	const { username, password } = req.body || {}
	const user = await db.prepare("SELECT * FROM users WHERE username = ?").get(username)
	if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
		return res.status(401).json({ error: "Неверный логин или пароль" })
	}
	res.json({ token: sign(user), user: publicUser(user) })
})

api.use(authenticate)

const AUDIT_LABELS = [
	[/^\/placements/, "Размещение"],
	[/^\/me\/issues/, "Заявка на ремонт"],
	[/^\/residents/, "Проживающий"],
	[/^\/rooms/, "Номер"],
	[/^\/hotels/, "Гостиница"],
	[/^\/classes/, "Класс номера"],
	[/^\/statuses/, "Статус"],
	[/^\/users/, "Пользователь"],
	[/^\/import/, "Импорт"],
	[/^\/me\/password/, "Пароль"],
	[/^\/admin\/backups/, "Резервная копия"],
]
const AUDIT_VERB = { POST: "создание", PUT: "изменение", DELETE: "удаление" }
function auditSummary(req) {
	const entity = (AUDIT_LABELS.find(([re]) => re.test(req.path)) || [, "Запись"])[1];
	if (entity === "Заявка на ремонт" && req.method === "POST") return "Подана заявка на ремонт";
	if (entity === "Резервная копия" && req.path.endsWith("/restore")) return "Восстановление из резервной копии";
	if (entity === "Размещение") {
		if (req.method === "DELETE" || (req.method === "PUT" && req.body?.stage === "cancelled")) {
			return "Размещение: отмена брони";
		}
	}
	return `${entity}: ${AUDIT_VERB[req.method] || req.method.toLowerCase()}`;
}

api.use((req, res, next) => {
	// Отметка «объявления прочитаны» — не изменение данных, журнал ею не засоряем.
	if (["POST", "PUT", "DELETE"].includes(req.method) && req.path !== "/me/announcements/seen") {
		const orig = res.json.bind(res)
		res.json = (body) => {
			if (res.statusCode < 400) {
				// res.json синхронный, а запись в PostgreSQL — нет. Ждать её здесь значит
				// задерживать ответ ради журнала; сбой журналирования тем более не должен
				// ронять саму операцию. Поэтому пишем вдогонку и только логируем ошибку.
				db.prepare("INSERT INTO audit_log (user_id, username, method, path, summary) VALUES (?,?,?,?,?)")
					.run(req.user?.id ?? null, req.user?.username ?? null, req.method, req.path, auditSummary(req))
					.catch((e) => console.error("Журнал действий:", e.message))
			}
			return orig(body)
		}
	}
	next()
})

api.get("/me", async (req, res) => res.json(req.user))

api.post("/me/password", async (req, res) => {
	const { current, next } = req.body || {}
	if (weakPassword(next)) return res.status(400).json({ error: `Новый пароль слишком короткий (мин. ${MIN_PASSWORD} символов)` })
	const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)
	if (!user || !bcrypt.compareSync(current || "", user.password_hash)) {
		return res.status(400).json({ error: "Текущий пароль неверный" })
	}
	await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(bcrypt.hashSync(next, 10), req.user.id)
	res.json({ ok: true })
})

async function activePlacement(residentId) {
	const today = todayStr()
	return await db
		.prepare(
			`SELECT p.id, p.date_from, p.date_to, p.stage, p.comment,
				s.name AS status_name, s.color AS status_color,
				b.id AS bed_id, b.label AS bed_label,
				rm.id AS room_id, rm.number AS room_number, rm.floor, rm.capacity, rm.description AS room_description,
				c.name AS class_name,
				h.id AS hotel_id, h.name AS hotel_name, h.settlement AS hotel_settlement
			 FROM placements p
			 JOIN beds b ON b.id = p.bed_id
			 JOIN rooms rm ON rm.id = b.room_id
			 LEFT JOIN room_classes c ON c.id = rm.class_id
			 JOIN hotels h ON h.id = rm.hotel_id
			 JOIN statuses s ON s.id = p.status_id
			 WHERE p.resident_id = ? AND p.stage <> 'cancelled'
			 ORDER BY CASE WHEN ? BETWEEN p.date_from AND p.date_to THEN 0 WHEN p.date_from > ? THEN 1 ELSE 2 END,
				abs(p.date_from::date - ?::date)
			 LIMIT 1`,
		)
		.get(residentId, today, today, today)
}

// Сводка по вахте: сколько всего дней, какой день идёт, сколько осталось.
// Считаем на сервере, чтобы клиент не занимался арифметикой дат в часовых поясах.
function staySummary(pl) {
	if (!pl) return null
	const day = 86400000
	const startOfDay = (s) => {
		const [y, m, d] = String(s).split("-").map(Number)
		return Date.UTC(y, (m || 1) - 1, d || 1)
	}
	const now = new Date()
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
	const from = startOfDay(pl.date_from)
	const to = startOfDay(pl.date_to)
	const total = Math.max(1, Math.round((to - from) / day))
	const passed = Math.round((today - from) / day)
	const left = Math.round((to - today) / day)
	return {
		total_days: total,
		days_left: left,
		days_passed: Math.min(Math.max(passed, 0), total),
		day_number: Math.min(Math.max(passed + 1, 1), total),
		percent: Math.min(100, Math.max(0, Math.round((Math.min(Math.max(passed, 0), total) / total) * 100))),
		started: today >= from,
		finished: today > to,
		date_from: pl.date_from,
		date_to: pl.date_to,
	}
}

api.get("/me/overview", async (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.json({ resident: null, placement: null, room: null, roommates: [], hotel: null })
	const resident = await db.prepare("SELECT id, full_name, tab_number, company, department, position, phone, about, photo, show_contacts FROM residents WHERE id = ?").get(rid)
	const pl = await activePlacement(rid)
	let room = null
	let roommates = []
	let hotel = null
	if (pl) {
		const roomAmenities = await db
			.prepare("SELECT a.name, a.icon FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id WHERE ra.room_id = ? ORDER BY a.name")
			.all(pl.room_id)
		const roomRev = await db
			.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE room_id = ?")
			.get(pl.room_id)
		room = {
			id: pl.room_id,
			number: pl.room_number,
			floor: pl.floor,
			capacity: pl.capacity,
			class_name: pl.class_name,
			description: pl.room_description,
			amenities: roomAmenities,
			images: await imagesFor("room", pl.room_id),
			rating: roomRev.avg ? Math.round(roomRev.avg * 10) / 10 : null,
			reviews_count: roomRev.c,
			// Открытые заявки по номеру — вахтовик видит, что поломка уже в работе
			open_issues: (await db
				.prepare("SELECT COUNT(*) c FROM room_issues WHERE room_id = ? AND status <> 'Починено'")
				.get(pl.room_id)).c,
		}
		roommates = await db
			.prepare(
				`SELECT DISTINCT r.id, r.full_name, r.company, r.position, r.about, r.photo,
					CASE WHEN r.show_contacts = 1 THEN r.phone ELSE NULL END AS phone,
					b.label AS bed_label, p.date_from, p.date_to
				 FROM placements p
				 JOIN beds b ON b.id = p.bed_id
				 JOIN residents r ON r.id = p.resident_id
				 WHERE b.room_id = ? AND p.stage <> 'cancelled' AND r.id <> ?
					AND p.date_from < ? AND p.date_to > ?
				 ORDER BY r.full_name`,
			)
			.all(pl.room_id, rid, pl.date_to, pl.date_from)
		const h = await db.prepare("SELECT * FROM hotels WHERE id = ?").get(pl.hotel_id)
		const hotelAmenities = await db
			.prepare("SELECT a.name, a.icon FROM hotel_amenities ha JOIN amenities a ON a.id = ha.amenity_id WHERE ha.hotel_id = ? ORDER BY a.name")
			.all(pl.hotel_id)
		const places = await db.prepare("SELECT id, name, kind, note, distance, latitude, longitude, icon FROM places WHERE hotel_id = ? ORDER BY name").all(pl.hotel_id)
		const info = await db.prepare("SELECT id, kind, title, body, sort FROM hotel_info_sections WHERE hotel_id = ? ORDER BY sort, id").all(pl.hotel_id)
		const rev = await db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ? AND room_id IS NULL").get(pl.hotel_id)
		hotel = {
			...h,
			amenities: hotelAmenities,
			places,
			info,
			images: await imagesFor("hotel", pl.hotel_id),
			rating: rev.avg ? Math.round(rev.avg * 10) / 10 : null,
			reviews_count: rev.c,
		}
	}
	const myReview = pl
		? await db.prepare("SELECT id, rating, text, reply, reply_at FROM reviews WHERE hotel_id = ? AND resident_id = ? AND room_id IS NULL").get(pl.hotel_id, rid)
		: null
	const myRoomReview = pl
		? await db.prepare("SELECT id, rating, text, reply, reply_at FROM reviews WHERE room_id = ? AND resident_id = ?").get(pl.room_id, rid)
		: null
	// Отзывы прошлых и нынешних жильцов об этом номере и доме — без имён (комендант может удалить)
	const reviews = pl
		? await db
				.prepare(
					`SELECT id, rating, text, reply, reply_at, created_at, CASE WHEN room_id IS NULL THEN 'hotel' ELSE 'room' END AS target
					 FROM reviews
					 WHERE resident_id IS DISTINCT FROM ? AND (room_id = ? OR (hotel_id = ? AND room_id IS NULL))
					 ORDER BY created_at DESC LIMIT 200`,
				)
				.all(rid, pl.room_id, pl.hotel_id)
		: []
	res.json({
		resident,
		placement: pl || null,
		reviews,
		stay: staySummary(pl),
		room,
		roommates,
		hotel,
		my_review: myReview || null,
		my_room_review: myRoomReview || null,
	})
})

api.post("/me/review", async (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.status(400).json({ error: "Профиль не привязан" })
	const rating = Number(req.body?.rating)
	if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: "Оценка должна быть от 1 до 5" })
	const pl = await activePlacement(rid)
	if (!pl) return res.status(400).json({ error: "Нет активного размещения" })
	const text = req.body?.text || null
	// target: "hotel" — отзыв о доме, "room" — о своём номере
	const forRoom = req.body?.target === "room"
	const roomId = forRoom ? pl.room_id : null
	await db.tx(async (t) => {
		if (forRoom) await t.prepare("DELETE FROM reviews WHERE room_id = ? AND resident_id = ?").run(roomId, rid)
		else await t.prepare("DELETE FROM reviews WHERE hotel_id = ? AND resident_id = ? AND room_id IS NULL").run(pl.hotel_id, rid)
		await t.prepare("INSERT INTO reviews (hotel_id, room_id, resident_id, rating, text) VALUES (?,?,?,?,?)").run(pl.hotel_id, roomId, rid, rating, text)
	})
	res.json({ ok: true })
})

api.put("/me/profile", async (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.status(400).json({ error: "Профиль не привязан" })
	const { about, photo, phone, show_contacts } = req.body || {}
	await db.prepare("UPDATE residents SET about = ?, photo = ?, phone = ?, show_contacts = ? WHERE id = ?").run(
		about ?? null,
		photo ?? null,
		phone ?? null,
		show_contacts ? 1 : 0,
		rid,
	)
	res.json({ ok: true })
})

// Счётчик СВОИХ незакрытых заявок — для вахтовика
api.get("/me/issues/count", async (req, res) => {
	const row = await db
		.prepare("SELECT COUNT(*) AS count FROM room_issues WHERE user_id = ? AND status <> 'Починено'")
		.get(req.user.id)
	res.json({ count: row?.count || 0 })
})

api.post("/me/issues", async (req, res) => {
	const { room_id, amenity_name, comment, photo } = req.body || {}
	if (!room_id) return res.status(400).json({ error: "Не указан ID комнаты" })
	if (!comment || !comment.trim()) return res.status(400).json({ error: "Пожалуйста, опишите проблему" })
	// Вахтовик подаёт заявку только по своему номеру; персонал — по любому.
	if (!isStaffUser(req.user)) {
		const mine = req.user.resident_id ? await activePlacement(req.user.resident_id) : null
		if (!mine || Number(mine.room_id) !== Number(room_id)) {
			return res.status(403).json({ error: "Заявку можно подать только по своему номеру" })
		}
	}

	try {
		const info = await db.prepare(`
			INSERT INTO room_issues (room_id, user_id, amenity_name, comment, photo, status)
			VALUES (?, ?, ?, ?, ?, 'Новая')
		`).run(room_id, req.user?.id ?? null, amenity_name, comment.trim(), photo || null)

		const mates = await roomUserIds(room_id)
		broadcast("issues:changed", { issueId: Number(info.lastInsertRowid) }, (user) => STAFF_ROLES.has(user.role) || user.id === req.user.id || mates.includes(user.id))
		res.json({ ok: true, id: info.lastInsertRowid })
	} catch (e) {
		console.error("POST /me/issues:", e.message)
		res.status(500).json({ error: "Не удалось сохранить заявку" })
	}
})


api.post("/upload", uploadImage.single("file"), async (req, res) => {
	if (!req.file) return res.status(400).json({ error: "Файл не загружен (только изображения до 5 МБ)" })
	res.json({ url: `/uploads/${req.file.filename}` })
})

const isStaffUser = (u) => u?.role === "admin" || u?.role === "editor" || u?.role === "maintenance"
const canViewAllIssues = (u) => isStaffUser(u) || u?.role === "observer"

async function announcementsFor(hotelId) {
	return await db
		.prepare(
			`SELECT a.id, a.hotel_id, a.title, a.body, a.pinned, a.created_at, u.full_name AS author, h.name AS hotel_name
			 FROM announcements a
			 LEFT JOIN users u ON u.id = a.created_by
			 LEFT JOIN hotels h ON h.id = a.hotel_id
			 WHERE a.hotel_id IS NULL OR a.hotel_id = ?
			 ORDER BY a.pinned DESC, a.created_at DESC`,
		)
		.all(hotelId ?? -1)
}

// Заявки вахтовика: свои (все) + открытые заявки соседей по текущему номеру.
// Поломка в комнате общая — соседи видят её и пишут в неё, а не заводят вторую такую же.
async function myIssues(user) {
	const pl = user.resident_id ? await activePlacement(user.resident_id) : null
	return await db
		.prepare(
			`SELECT ri.id, ri.room_id, ri.amenity_name, ri.comment, ri.status, ri.photo, ri.created_at,
				rm.number AS room_number, h.name AS hotel_name,
				(ri.user_id = ?) AS mine, u.full_name AS author,
				(SELECT COUNT(*) FROM issue_comments ic WHERE ic.issue_id = ri.id) AS comments_count
			 FROM room_issues ri
			 JOIN rooms rm ON rm.id = ri.room_id
			 JOIN hotels h ON h.id = rm.hotel_id
			 LEFT JOIN users u ON u.id = ri.user_id
			 WHERE ri.user_id = ? OR (ri.room_id = ? AND ri.status <> 'Починено')
			 ORDER BY (ri.status = 'Починено'), ri.id DESC`,
		)
		.all(user.id, user.id, pl?.room_id ?? -1)
}
// Может ли вахтовик видеть заявку и писать в неё: своя или по его текущему номеру
// Учётки вахтовиков, живущих в номере сейчас
async function roomUserIds(roomId) {
	const rows = await db
		.prepare(
			`SELECT DISTINCT u.id FROM users u JOIN placements p ON p.resident_id = u.resident_id JOIN beds b ON b.id = p.bed_id
			 WHERE b.room_id = ? AND p.stage <> 'cancelled' AND ? BETWEEN p.date_from AND p.date_to`,
		)
		.all(roomId, todayStr())
	return rows.map((r) => r.id)
}
async function issueVisibleToResident(issue, user) {
	if (issue.user_id === user.id) return true
	const pl = user.resident_id ? await activePlacement(user.resident_id) : null
	return !!pl && Number(pl.room_id) === Number(issue.room_id)
}

api.get("/me/announcements", async (req, res) => {
	const pl = req.user.resident_id ? await activePlacement(req.user.resident_id) : null
	res.json(await announcementsFor(pl?.hotel_id))
})

api.post("/me/announcements/seen", async (req, res) => {
	await db.prepare("UPDATE users SET announcements_seen_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(req.user.id)
	res.json({ ok: true })
})

api.get("/me/feed", async (req, res) => {
	const rid = req.user.resident_id
	const resident = rid ? await db.prepare("SELECT id, full_name FROM residents WHERE id = ?").get(rid) : null
	const pl = rid ? await activePlacement(rid) : null
	const announcements = await announcementsFor(pl?.hotel_id)
	const seen = (await db.prepare("SELECT announcements_seen_at FROM users WHERE id = ?").get(req.user.id))?.announcements_seen_at
	const unread = announcements.filter((a) => !seen || a.created_at > seen).length
	// Дежурная информация для главной: к кому звонить и во сколько выезжать
	const hotel = pl
		? await db.prepare("SELECT id, name, settlement, address, phone, check_in, check_out FROM hotels WHERE id = ?").get(pl.hotel_id)
		: null
	res.json({
		resident,
		placement: pl || null,
		stay: staySummary(pl),
		hotel,
		announcements,
		unread,
		// когда последний раз смотрел — чтобы пометить новые объявления
		seen_at: seen || null,
		issues: await myIssues(req.user),
	})
})

api.get("/me/issues", async (req, res) => res.json(await myIssues(req.user)))

// Пуш-уведомления: ключ для подписки, подписать/отписать это устройство
api.get("/me/push", async (_req, res) => res.json({ key: await push.publicKey() }))
api.post("/me/push", async (req, res) => {
	const { endpoint, keys } = req.body || {}
	if (!String(endpoint || "").startsWith("https://") || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: "Неверная подписка" })
	await db
		.prepare(
			`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
			 ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
		)
		.run(req.user.id, endpoint, keys.p256dh, keys.auth)
	res.json({ ok: true })
})
api.post("/me/push/off", async (req, res) => {
	await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(req.body?.endpoint || "", req.user.id)
	res.json({ ok: true })
})

// История вахт: где и когда жил (без отменённых) — для профиля
api.get("/me/stays", async (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.json([])
	res.json(
		await db
			.prepare(
				`SELECT p.id, p.date_from, p.date_to, p.stage, h.name AS hotel_name, h.settlement, rm.number AS room_number, b.label AS bed_label
				 FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hotels h ON h.id = rm.hotel_id
				 WHERE p.resident_id = ? AND p.stage <> 'cancelled'
				 ORDER BY p.date_from DESC`,
			)
			.all(rid),
	)
})

// План своего этажа для вахтовика: где мой номер и что рядом (душ, кухня, выход).
// Отдаём только номера и элементы своего этажа, без данных о жильцах.
api.get("/me/plan", async (req, res) => {
	const rid = req.user.resident_id
	const pl = rid ? await activePlacement(rid) : null
	if (!pl) return res.json({ available: false })
	const floor = pl.floor ?? 1
	const rooms = await db
		.prepare(
			`SELECT id, number, floor, capacity, plan_x, plan_y, plan_w, plan_h, plan_cells
			 FROM rooms WHERE hotel_id = ? AND COALESCE(floor, 1) = ? AND plan_x IS NOT NULL
			 ORDER BY number`,
		)
		.all(pl.hotel_id, floor)
	const shapes = await db
		.prepare("SELECT id, kind, label, x, y, w, h, cells FROM plan_shapes WHERE hotel_id = ? AND floor = ? ORDER BY id")
		.all(pl.hotel_id, floor)
	const image = (await db.prepare("SELECT url FROM floor_images WHERE hotel_id = ? AND floor = ?").get(pl.hotel_id, floor))?.url || null
	res.json({
		available: rooms.length > 0 || shapes.length > 0 || !!image,
		image,
		floor,
		hotel_name: pl.hotel_name,
		my_room_id: pl.room_id,
		my_room_number: pl.room_number,
		rooms,
		shapes,
	})
})

api.get("/issues/:id/comments", async (req, res) => {
	const issue = await db.prepare("SELECT user_id, room_id FROM room_issues WHERE id = ?").get(req.params.id)
	if (!issue) return res.status(404).json({ error: "Заявка не найдена" })
	if (!canViewAllIssues(req.user) && !(await issueVisibleToResident(issue, req.user))) return res.status(403).json({ error: "Недостаточно прав" })
	res.json(
		await db
			.prepare(
				`SELECT ic.id, ic.text, ic.photo, ic.created_at, ic.user_id, u.full_name AS author, u.role AS author_role, (u.resident_id IS NULL) AS author_staff
				 FROM issue_comments ic LEFT JOIN users u ON u.id = ic.user_id
				 WHERE ic.issue_id = ? ORDER BY ic.id`,
			)
			.all(req.params.id),
	)
})

api.post("/issues/:id/comments", async (req, res) => {
	const issue = await db.prepare("SELECT user_id, room_id, status FROM room_issues WHERE id = ?").get(req.params.id)
	if (!issue) return res.status(404).json({ error: "Заявка не найдена" })
	if (!isStaffUser(req.user) && !(await issueVisibleToResident(issue, req.user))) return res.status(403).json({ error: "Недостаточно прав" })
	// Починенная заявка закрыта: переписка только для чтения с обеих сторон
	if (issue.status === "Починено")
		return res.status(409).json({
			error: isStaffUser(req.user) ? "Заявка закрыта. Чтобы написать, верните её в работу." : "Заявка закрыта. Если снова сломалось — создайте новую.",
		})
	const text = (req.body?.text || "").trim()
	const photo = req.body?.photo || null
	if (photo && !/^\/uploads\/[\w.-]+$/.test(photo)) return res.status(400).json({ error: "Сначала загрузите фото" })
	if (!text && !photo) return res.status(400).json({ error: "Введите сообщение" })
	const info = await db.prepare("INSERT INTO issue_comments (issue_id, user_id, text, photo) VALUES (?,?,?,?)").run(req.params.id, req.user.id, text, photo)
	// Заявка общая на номер — сообщение видят и те, кто живёт в нём сейчас
	const mates = await roomUserIds(issue.room_id)
	broadcast("issue:comment", { issueId: Number(req.params.id) }, (user) => STAFF_ROLES.has(user.role) || user.id === issue.user_id || mates.includes(user.id))
	// Ответ коменданта — пушем автору и соседям
	if (isStaffUser(req.user))
		push.notify([issue.user_id, ...mates].filter((id) => id !== req.user.id), {
			title: "Комендант ответил по заявке",
			body: !text ? "📷 Фото" : text.length > 140 ? text.slice(0, 140) + "…" : text,
			url: "/me/issues",
			tag: "issue-" + req.params.id,
		})
	res.json({ id: info.lastInsertRowid })
})

api.use(requireStaff)

api.get("/map", async (req, res) => {
	const today = todayStr()
	const hotels = await db.prepare("SELECT id, name, settlement, address, phone, latitude, longitude FROM hotels ORDER BY name").all()
	const out = await Promise.all(hotels.map(async (h) => {
		const beds = (await db.prepare("SELECT COUNT(*) c FROM beds b JOIN rooms rm ON rm.id = b.room_id WHERE rm.hotel_id = ?").get(h.id)).c
		const occupied = (await db
			.prepare(
				`SELECT COUNT(DISTINCT p.bed_id) c FROM placements p
				 JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
				 WHERE rm.hotel_id = ? AND p.stage IN ('expected','checked_in') AND p.date_from <= ? AND p.date_to > ?`,
			)
			.get(h.id, today, today)).c
		const arrivals = (await db
			.prepare(
				`SELECT COUNT(*) c FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
				 WHERE rm.hotel_id = ? AND p.date_from = ? AND p.stage <> 'cancelled'`,
			)
			.get(h.id, today)).c
		const repair = (await db
			.prepare(
				`SELECT COUNT(*) c FROM room_blocks rb JOIN rooms rm ON rm.id = rb.room_id
				 WHERE rm.hotel_id = ? AND rb.date_from <= ? AND rb.date_to >= ?`,
			)
			.get(h.id, today, today)).c
		const rev = await db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ? AND room_id IS NULL").get(h.id)
		const rooms = (await db.prepare("SELECT COUNT(*) c FROM rooms WHERE hotel_id = ?").get(h.id)).c
		const departures = (await db
			.prepare(
				`SELECT COUNT(*) c FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
				 WHERE rm.hotel_id = ? AND p.date_to = ? AND p.stage <> 'cancelled'`,
			)
			.get(h.id, today)).c
		const issues = (await db
			.prepare(
				`SELECT COUNT(*) c FROM room_issues ri JOIN rooms rm ON rm.id = ri.room_id
				 WHERE rm.hotel_id = ? AND ri.status <> 'Починено'`,
			)
			.get(h.id)).c
		return {
			id: h.id,
			name: h.name,
			settlement: h.settlement,
			address: h.address,
			phone: h.phone,
			latitude: h.latitude ? Number(h.latitude) : null,
			longitude: h.longitude ? Number(h.longitude) : null,
			rooms,
			beds,
			occupied,
			free: Math.max(0, beds - occupied),
			arrivals,
			departures,
			repair,
			issues,
			occupancy: beds ? Math.round((occupied / beds) * 100) : 0,
			rating: rev.avg ? Math.round(rev.avg * 10) / 10 : null,
		}
	}))
	res.json(out)
})

api.get("/announcements", async (_req, res) =>
	res.json(
		await db
			.prepare(
				`SELECT a.*, u.full_name AS author, h.name AS hotel_name
				 FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN hotels h ON h.id = a.hotel_id
				 ORDER BY a.pinned DESC, a.created_at DESC`,
			)
			.all(),
	),
)
api.post("/announcements", requireRole("editor"), async (req, res) => {
	const { hotel_id, title, body, pinned } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	const info = await db
		.prepare("INSERT INTO announcements (hotel_id, title, body, pinned, created_by) VALUES (?,?,?,?,?)")
		.run(hotel_id || null, title, body, pinned ? 1 : 0, req.user.id)
	broadcast("announcements:changed", { hotelId: hotel_id || null })
	const to = await db
		.prepare(
			`SELECT DISTINCT u.id FROM users u JOIN placements p ON p.resident_id = u.resident_id
			 JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
			 WHERE p.stage <> 'cancelled' AND p.date_to >= ? AND (?::int IS NULL OR rm.hotel_id = ?)`,
		)
		.all(todayStr(), hotel_id || null, hotel_id || null)
	push.notify(
		to.map((r) => r.id),
		{ title, body: body.length > 140 ? body.slice(0, 140) + "…" : body, url: "/me", tag: "ann-" + info.lastInsertRowid },
	)
	res.json({ id: info.lastInsertRowid })
})
api.put("/announcements/:id", requireRole("editor"), async (req, res) => {
	const { hotel_id, title, body, pinned } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	await db.prepare("UPDATE announcements SET hotel_id=?, title=?, body=?, pinned=? WHERE id=?").run(hotel_id || null, title, body, pinned ? 1 : 0, req.params.id)
	broadcast("announcements:changed", { hotelId: hotel_id || null })
	res.json({ ok: true })
})
api.delete("/announcements/:id", requireRole("editor"), async (req, res) => {
	await db.prepare("DELETE FROM announcements WHERE id = ?").run(req.params.id)
	broadcast("announcements:changed", {})
	res.json({ ok: true })
})

api.get("/issues", async (req, res) => {
	const filters = []
	const args = []
	if (req.query.status) {
		filters.push("ri.status = ?")
		args.push(req.query.status)
	}
	if (req.query.hotel_id) {
		filters.push("rm.hotel_id = ?")
		args.push(req.query.hotel_id)
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
	res.json(
		await db
			.prepare(
				`SELECT ri.*, rm.number AS room_number, h.name AS hotel_name, h.id AS hotel_id, u.full_name AS user_name,
					(SELECT COUNT(*) FROM issue_comments ic WHERE ic.issue_id = ri.id) AS comments_count
				 FROM room_issues ri
				 JOIN rooms rm ON rm.id = ri.room_id
				 JOIN hotels h ON h.id = rm.hotel_id
				 LEFT JOIN users u ON u.id = ri.user_id
				 ${where}
				 ORDER BY CASE ri.status WHEN 'Новая' THEN 0 WHEN 'В работе' THEN 1 ELSE 2 END, ri.id DESC`,
			)
			.all(...args),
	)
})

api.put("/reviews/:id/reply", requireRole("editor"), async (req, res) => {
	const reply = (req.body?.reply || "").trim()
	await db.prepare("UPDATE reviews SET reply = ?, reply_at = CASE WHEN ? = '' THEN NULL ELSE to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') END WHERE id = ?").run(reply || null, reply, req.params.id)
	res.json({ ok: true })
})

api.get("/hotels/:id/info", async (req, res) => res.json(await db.prepare("SELECT * FROM hotel_info_sections WHERE hotel_id = ? ORDER BY sort, id").all(req.params.id)))
api.post("/hotels/:id/info", requireRole("editor"), async (req, res) => {
	const { kind, title, body, sort } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	const info = await db
		.prepare("INSERT INTO hotel_info_sections (hotel_id, kind, title, body, sort) VALUES (?,?,?,?,?)")
		.run(req.params.id, kind || "custom", title, body, Number(sort) || 0)
	res.json({ id: info.lastInsertRowid })
})
api.put("/info/:id", requireRole("editor"), async (req, res) => {
	const { kind, title, body, sort } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	await db.prepare("UPDATE hotel_info_sections SET kind=?, title=?, body=?, sort=? WHERE id=?").run(kind || "custom", title, body, Number(sort) || 0, req.params.id)
	res.json({ ok: true })
})
api.delete("/info/:id", requireRole("editor"), async (req, res) => {
	await db.prepare("DELETE FROM hotel_info_sections WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.use("/admin/backups", requireRole("admin"), backups.router)

// Место на диске и уборка (см. server/storage.js)
api.get("/admin/storage", requireRole("admin"), async (_req, res) => res.json(await storage.plan()))
api.post("/admin/storage/cleanup", requireRole("admin"), async (_req, res) => res.json(await storage.cleanup()))

// Версия и итог последнего автообновления (его пишет scripts/update.sh в data/update-status.json)
const dataFile = (name) => path.join(__dirname, "..", "data", name)
const readText = (name) => {
	try {
		return fs.readFileSync(dataFile(name), "utf8").trim()
	} catch {
		return null
	}
}
api.get("/admin/version", requireRole("admin"), async (_req, res) => {
	let update = null
	try {
		update = JSON.parse(readText("update-status.json"))
	} catch {}
	res.json({
		version: process.env.APP_VERSION || "dev",
		built_at: process.env.APP_BUILT_AT || null,
		update,
		checked_at: readText("update-checked-at"), // пишет scripts/update.sh при каждой проверке
		requested_at: readText("update-request"),
	})
})
// «Проверить сейчас»: файл-сигнал, его ловит systemd (hiagda-update.path) и запускает update.sh.
// Приложению не нужны ни root, ни доступ к Docker.
api.post("/admin/update/check", requireRole("admin"), async (_req, res) => {
	const at = new Date().toISOString()
	fs.writeFileSync(dataFile("update-request"), at + "\n")
	res.json({ requested_at: at })
})

api.get("/audit", requireRole("admin"), async (req, res) => {
	const limit = Math.min(500, Number(req.query.limit) || 200)
	res.json(await db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit))
})

api.get("/movements", async (req, res) => {
	const date = req.query.date || todayStr()
	const base = `
		SELECT p.id, p.date_from, p.date_to, p.comment, p.stage,
			r.full_name AS resident_name, r.company,
			s.name AS status_name, s.color AS status_color,
			b.label AS bed_label, rm.number AS room_number, h.name AS hotel_name
		FROM placements p
		JOIN beds b ON b.id = p.bed_id
		JOIN rooms rm ON rm.id = b.room_id
		JOIN hotels h ON h.id = rm.hotel_id
		JOIN statuses s ON s.id = p.status_id
		LEFT JOIN residents r ON r.id = p.resident_id`
	res.json({
		date,
		arrivals: await db.prepare(`${base} WHERE p.date_from = ? AND p.stage <> 'cancelled' ORDER BY h.name, rm.number`).all(date),
		departures: await db.prepare(`${base} WHERE p.date_to = ? AND p.stage <> 'cancelled' ORDER BY h.name, rm.number`).all(date),
	})
})

api.get("/journal", async (req, res) => {
	const filters = []
	const args = []
	if (req.query.hotel_id) {
		filters.push("rm.hotel_id = ?")
		args.push(req.query.hotel_id)
	}
	if (req.query.from && req.query.to) {
		filters.push("p.date_from <= ? AND p.date_to > ?")
		args.push(req.query.to, req.query.from)
	}
	if (req.query.q) {
		filters.push("(r.full_name ILIKE ? OR rm.number ILIKE ? OR r.company ILIKE ?)")
		args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`)
	}
	if (req.query.stage) {
		filters.push("p.stage = ?")
		args.push(req.query.stage)
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
	res.json(
		await db
			.prepare(
				`SELECT p.id, p.date_from, p.date_to, p.comment, p.stage,
					p.resident_id, r.full_name AS resident_name, r.company, r.tab_number,
					s.name AS status_name, s.color AS status_color,
					b.label AS bed_label, rm.number AS room_number, h.name AS hotel_name
				 FROM placements p
				 JOIN beds b ON b.id = p.bed_id
				 JOIN rooms rm ON rm.id = b.room_id
				 JOIN hotels h ON h.id = rm.hotel_id
				 JOIN statuses s ON s.id = p.status_id
				 LEFT JOIN residents r ON r.id = p.resident_id
				 ${where} ORDER BY p.date_from DESC LIMIT 500`,
			)
			.all(...args),
	)
})

api.get("/summary", async (req, res) => {
	const today = todayStr()
	const hotels = await db.prepare("SELECT id, name FROM hotels ORDER BY name").all()
	const result = await Promise.all(hotels.map(async (h) => {
		const beds = (await db
			.prepare(
				"SELECT COUNT(*) c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.hotel_id = ?",
			)
			.get(h.id)).c
		const occupied = (await db
			.prepare(
				`SELECT COUNT(DISTINCT b.id) c
				 FROM beds b JOIN rooms r ON r.id = b.room_id
				 JOIN placements p ON p.bed_id = b.id
				 WHERE r.hotel_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ?`,
			)
			.get(h.id, today, today)).c
		const rooms = (await db.prepare("SELECT COUNT(*) c FROM rooms WHERE hotel_id = ?").get(h.id)).c
		return { ...h, rooms, beds, occupied, free: beds - occupied, load: beds ? Math.round((occupied / beds) * 100) : 0 }
	}))
	res.json(result)
})

api.get("/dashboard", async (req, res) => {
	const today = todayStr()
	const hotels = await db.prepare("SELECT id, name FROM hotels ORDER BY name").all()
	let tRooms = 0
	let tBeds = 0
	let tOcc = 0
	const hotelStats = await Promise.all(hotels.map(async (h) => {
		const beds = (await db.prepare("SELECT COUNT(*) c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.hotel_id = ?").get(h.id)).c
		const occupied = (await db
			.prepare(
				`SELECT COUNT(DISTINCT b.id) c FROM beds b JOIN rooms r ON r.id = b.room_id
				 JOIN placements p ON p.bed_id = b.id
				 WHERE r.hotel_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ?`,
			)
			.get(h.id, today, today)).c
		const rooms = (await db.prepare("SELECT COUNT(*) c FROM rooms WHERE hotel_id = ?").get(h.id)).c
		tRooms += rooms
		tBeds += beds
		tOcc += occupied
		return { ...h, rooms, beds, occupied, free: beds - occupied, load: beds ? Math.round((occupied / beds) * 100) : 0 }
	}))

	const trendStmt = db.prepare(
		`SELECT COUNT(DISTINCT p.bed_id) c FROM placements p
		 WHERE p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ?`,
	)
	const trend = []
	for (let i = 0; i < 14; i++) {
		const day = addDays(today, i)
		const occ = (await trendStmt.get(day, day)).c
		trend.push({ date: day, occupied: occ, free: tBeds - occ, load: tBeds ? Math.round((occ / tBeds) * 100) : 0 })
	}

	const stageRow = await db
		.prepare(
			`SELECT
				SUM(CASE WHEN stage = 'expected' THEN 1 ELSE 0 END) expected,
				SUM(CASE WHEN stage = 'checked_in' THEN 1 ELSE 0 END) checked_in,
				SUM(CASE WHEN stage = 'checked_out' THEN 1 ELSE 0 END) checked_out,
				SUM(CASE WHEN stage = 'cancelled' THEN 1 ELSE 0 END) cancelled
			 FROM placements WHERE date_to >= ?`,
		)
		.get(today)
	const stages = {
		expected: stageRow.expected || 0,
		checked_in: stageRow.checked_in || 0,
		checked_out: stageRow.checked_out || 0,
		cancelled: stageRow.cancelled || 0,
	}
	const countOn = async (col) =>
		(await db.prepare(`SELECT COUNT(*) c FROM placements WHERE ${col} = ? AND stage <> 'cancelled'`).get(today)).c
	const moveBase = `
		SELECT p.id, p.stage, p.date_from, p.date_to, r.full_name AS resident_name, rm.hotel_id,
			rm.number AS room_number, h.name AS hotel_name, b.label AS bed_label
		FROM placements p
		JOIN beds b ON b.id = p.bed_id
		JOIN rooms rm ON rm.id = b.room_id
		JOIN hotels h ON h.id = rm.hotel_id
		LEFT JOIN residents r ON r.id = p.resident_id`
	res.json({
		date: today,
		totals: {
			hotels: hotels.length,
			rooms: tRooms,
			beds: tBeds,
			occupied: tOcc,
			free: tBeds - tOcc,
			load: tBeds ? Math.round((tOcc / tBeds) * 100) : 0,
			checkins: await countOn("date_from"),
			checkouts: await countOn("date_to"),
			inhouse: stages.checked_in,
		},
		stages,
		trend,
		hotels: hotelStats,
		arrivals: await db.prepare(`${moveBase} WHERE p.date_from = ? AND p.stage <> 'cancelled' ORDER BY h.name, rm.number LIMIT 12`).all(today),
		departures: await db.prepare(`${moveBase} WHERE p.date_to = ? AND p.stage <> 'cancelled' ORDER BY h.name, rm.number LIMIT 12`).all(today),
		// Что требует действия прямо сейчас: без этого ошибки в стадиях копятся незаметно
		attention: {
			overdue: await db.prepare(`${moveBase} WHERE p.stage = 'checked_in' AND p.date_to < ? ORDER BY p.date_to LIMIT 20`).all(today),
			noshow: await db.prepare(`${moveBase} WHERE p.stage = 'expected' AND p.date_from < ? ORDER BY p.date_from LIMIT 20`).all(today),
			issuesNew: (await db.prepare("SELECT COUNT(*) c FROM room_issues WHERE status = 'Новая'").get()).c,
			issuesOpen: (await db.prepare("SELECT COUNT(*) c FROM room_issues WHERE status <> 'Починено'").get()).c,
			repair: (await db.prepare("SELECT COUNT(*) c FROM room_blocks WHERE date_from <= ? AND date_to >= ?").get(today, today)).c,
		},
	})
})

api.get("/analytics", async (req, res) => {
	const today = todayStr()
	const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "")
	let from = isDate(req.query.from) ? req.query.from : today
	let to = isDate(req.query.to) ? req.query.to : addDays(today, 29)
	if (to < from) [from, to] = [to, from]
	// ponytail: до года за раз — дальше график нечитаем, а запрос по дням тяжелеет
	if (nights(from, to) > 365) to = addDays(from, 365)
	const days = nights(from, to) + 1
	const end = addDays(to, 1) // период [from, to] включительно = [from, end)

	const hId = req.query.hotel_id ? Number(req.query.hotel_id) : null
	const hf = hId ? "AND rm.hotel_id = ?" : ""
	const h = hId ? [hId] : []
	const joins = "FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id"
	const live = "p.stage <> 'cancelled'"

	const tBeds = (await db.prepare(`SELECT COUNT(*) c FROM beds b JOIN rooms rm ON rm.id = b.room_id WHERE TRUE ${hf}`).get(...h)).c
	const tRooms = (await db.prepare(`SELECT COUNT(*) c FROM rooms rm WHERE TRUE ${hf}`).get(...h)).c

	// По дням одним запросом: занято мест, заезды, выезды
	const daily = await db
		.prepare(
			`SELECT to_char(d, 'YYYY-MM-DD') AS date,
				(SELECT COUNT(DISTINCT p.bed_id) ${joins} WHERE ${live} ${hf} AND p.date_from <= to_char(d, 'YYYY-MM-DD') AND p.date_to > to_char(d, 'YYYY-MM-DD')) AS occupied,
				(SELECT COUNT(*) ${joins} WHERE ${live} ${hf} AND p.date_from = to_char(d, 'YYYY-MM-DD')) AS arrivals,
				(SELECT COUNT(*) ${joins} WHERE ${live} ${hf} AND p.date_to = to_char(d, 'YYYY-MM-DD')) AS departures
			 FROM generate_series(?::date, ?::date, interval '1 day') d ORDER BY d`,
		)
		.all(...h, ...h, ...h, from, to)
	for (const x of daily) x.load = tBeds ? Math.round((x.occupied / tBeds) * 100) : 0

	// Ночи проживания внутри периода: пересечение брони с [from, end)
	const overlap = `GREATEST(0, LEAST(nochotel_ymd(p.date_to), ?::date) - GREATEST(nochotel_ymd(p.date_from), ?::date))`
	const inPeriod = `${live} AND p.date_from < ? AND p.date_to > ?`
	const people = await db
		.prepare(
			`SELECT COUNT(DISTINCT p.resident_id) people, COUNT(*) stays,
				AVG(nochotel_ymd(p.date_to) - nochotel_ymd(p.date_from)) avg_stay
			 ${joins} WHERE ${inPeriod} ${hf}`,
		)
		.get(end, from, ...h)

	const byHotel = await db
		.prepare(
			`SELECT h.id, h.name,
				(SELECT COUNT(*) FROM beds b2 JOIN rooms r2 ON r2.id = b2.room_id WHERE r2.hotel_id = h.id) beds,
				COALESCE((SELECT SUM(${overlap}) ${joins} WHERE rm.hotel_id = h.id AND ${inPeriod}), 0) bed_nights
			 FROM hotels h ${hId ? "WHERE h.id = ?" : ""} ORDER BY h.name`,
		)
		.all(end, from, end, from, ...h)
	for (const x of byHotel) x.load = x.beds ? Math.round((x.bed_nights / (x.beds * days)) * 100) : 0

	const group = (col, empty) =>
		db
			.prepare(
				`SELECT COALESCE(NULLIF(r.${col}, ''), '${empty}') name, COUNT(DISTINCT r.id) people, COALESCE(SUM(${overlap}), 0) bed_nights
				 ${joins} JOIN residents r ON r.id = p.resident_id
				 WHERE ${inPeriod} ${hf} GROUP BY 1 ORDER BY bed_nights DESC LIMIT 8`,
			)
			.all(end, from, end, from, ...h)

	const issues = await db
		.prepare(
			`SELECT COUNT(*) created, SUM(CASE WHEN ri.status = 'Починено' THEN 1 ELSE 0 END) fixed
			 FROM room_issues ri JOIN rooms rm ON rm.id = ri.room_id
			 WHERE substr(ri.created_at, 1, 10) >= ? AND substr(ri.created_at, 1, 10) <= ? ${hf}`,
		)
		.get(from, to, ...h)

	const bedNights = daily.reduce((s, x) => s + x.occupied, 0)
	const peak = daily.reduce((m, x) => (x.occupied > m.occupied ? x : m), daily[0])
	res.json({
		today,
		from,
		to,
		days,
		totals: {
			rooms: tRooms,
			beds: tBeds,
			bedNights,
			avgLoad: tBeds ? Math.round((bedNights / (tBeds * days)) * 100) : 0,
			peak,
			arrivals: daily.reduce((s, x) => s + x.arrivals, 0),
			departures: daily.reduce((s, x) => s + x.departures, 0),
			people: people.people || 0,
			avgStay: people.avg_stay ? Math.round(people.avg_stay) : 0,
			issues: issues.created || 0,
			issuesFixed: issues.fixed || 0,
		},
		daily,
		byHotel,
		byCompany: await group("company", "Без организации"),
		byDepartment: await group("department", "Без подразделения"),
	})
})

api.get("/plan", async (req, res) => {
	try {
		// Извлекаем переданную дату из параметров запроса фронтенда
		const date = req.query.date || todayStr();

		// 1. Собираем комнаты с подсчетом новых жалоб
		const rooms = await db.prepare(`
			SELECT r.*, c.name AS class_name,
				(SELECT COUNT(*) FROM room_issues WHERE room_id = r.id AND status = 'Новая') AS has_new_issues,
				-- ДОБАВЛЕНО: считаем жалобы, которые прямо сейчас "В работе"
				(SELECT COUNT(*) FROM room_issues WHERE room_id = r.id AND status = 'В работе') AS has_fixing_issues
			FROM rooms r
			LEFT JOIN room_classes c ON c.id = r.class_id
			WHERE r.hotel_id = ? 
			ORDER BY r.floor, r.number
		`).all(req.query.hotel_id);

		const bedStmt = db.prepare("SELECT * FROM beds WHERE room_id = ? ORDER BY id")
		const plStmt = db.prepare(`
			SELECT p.id, p.resident_id, p.date_from, p.date_to, p.comment, p.stage,
				r.full_name AS resident_name, s.name AS status_name, s.color AS status_color
			FROM placements p
			JOIN statuses s ON s.id = p.status_id
			LEFT JOIN residents r ON r.id = p.resident_id
			WHERE p.bed_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ? LIMIT 1
		`)
		const blockStmt = db.prepare(`
			SELECT id, reason, date_from, date_to 
			FROM room_blocks 
			WHERE room_id = ? AND date_from <= ? AND date_to >= ? LIMIT 1
		`)

		for (const room of rooms) {
			room.beds = await Promise.all(
				(await bedStmt.all(room.id)).map(async (b) => ({ ...b, placement: (await plStmt.get(b.id, date, date)) || null })),
			)
			room.occupied = room.beds.filter((b) => b.placement).length
			room.block = await blockStmt.get(room.id, date, date) || null
		}

		const shapes = await db
			.prepare("SELECT id, floor, kind, label, x, y, w, h, cells FROM plan_shapes WHERE hotel_id = ? ORDER BY id")
			.all(req.query.hotel_id)

		const images = Object.fromEntries(
			(await db.prepare("SELECT floor, url FROM floor_images WHERE hotel_id = ?").all(req.query.hotel_id)).map((i) => [i.floor, i.url]),
		)
		res.json({ date, rooms, shapes, images })
	} catch (e) {
		console.error("GET /plan:", e.message)
		res.status(500).json({ error: "Не удалось загрузить план этажа" })
	}
})

// Фото этажа (план эвакуации, снимок схемы). url: null — убрать.
api.put("/plan/image", requireRole("editor"), async (req, res) => {
	const hotelId = Number(req.body?.hotel_id)
	const floor = Number(req.body?.floor)
	const url = req.body?.url || null
	if (!hotelId || !Number.isFinite(floor)) return res.status(400).json({ error: "Укажите гостиницу и этаж" })
	if (url && !/^\/uploads\/[\w.-]+$/.test(url)) return res.status(400).json({ error: "Сначала загрузите изображение" })
	if (url) {
		await db
			.prepare("INSERT INTO floor_images (hotel_id, floor, url) VALUES (?,?,?) ON CONFLICT (hotel_id, floor) DO UPDATE SET url = EXCLUDED.url")
			.run(hotelId, floor, url)
	} else {
		await db.prepare("DELETE FROM floor_images WHERE hotel_id = ? AND floor = ?").run(hotelId, floor)
	}
	res.json({ ok: true })
})

// Сохранение геометрии плана этажа: позиции номеров + элементы (коридоры, лестницы…).
// Приходит целиком по одному этажу — так проще держать план консистентным.
const SHAPE_KINDS = ["corridor", "stairs", "exit", "wc", "shower", "kitchen", "laundry", "lounge", "office", "other"]
api.put("/plan/layout", requireRole("editor"), async (req, res) => {
	const hotelId = Number(req.body?.hotel_id)
	const floor = Number(req.body?.floor)
	if (!hotelId || !Number.isFinite(floor)) return res.status(400).json({ error: "Укажите гостиницу и этаж" })

	const rooms = Array.isArray(req.body?.rooms) ? req.body.rooms : []
	const shapes = Array.isArray(req.body?.shapes) ? req.body.shapes : []
	const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)))


	// Маска "111/101": по строке на каждый ряд габарита, 1 — клетка занята.
	// Нормализуем под фактические w/h и отбрасываем сплошные маски (это обычный прямоугольник).
	const normCells = (raw, w, h) => {
		if (typeof raw !== "string" || !raw) return null
		const rows = raw.split("/").slice(0, h)
		const grid = []
		for (let y = 0; y < h; y++) {
			const row = (rows[y] || "").padEnd(w, "1").slice(0, w).replace(/[^01]/g, "1")
			grid.push(row)
		}
		if (!grid.join("").includes("0")) return null
		if (!grid.join("").includes("1")) return null
		return grid.join("/")
	}

	await db.tx(async (t) => {
		const ownRoom = t.prepare("SELECT id FROM rooms WHERE id = ? AND hotel_id = ? AND COALESCE(floor, 1) = ?")
		const setGeom = t.prepare("UPDATE rooms SET plan_x = ?, plan_y = ?, plan_w = ?, plan_h = ?, plan_cells = ? WHERE id = ?")
		for (const r of rooms) {
			if (!(await ownRoom.get(Number(r.id), hotelId, floor))) continue
			if (r.plan_x == null) {
				await setGeom.run(null, null, null, null, null, Number(r.id))
				continue
			}
			const w = clamp(r.plan_w, 1, 40)
			const h = clamp(r.plan_h, 1, 40)
			await setGeom.run(clamp(r.plan_x, 0, 200), clamp(r.plan_y, 0, 200), w, h, normCells(r.plan_cells, w, h), Number(r.id))
		}
		await t.prepare("DELETE FROM plan_shapes WHERE hotel_id = ? AND floor = ?").run(hotelId, floor)
		const insShape = t.prepare(
			"INSERT INTO plan_shapes (hotel_id, floor, kind, label, x, y, w, h, cells) VALUES (?,?,?,?,?,?,?,?,?)",
		)
		for (const s of shapes) {
			const w = clamp(s.w, 1, 40)
			const h = clamp(s.h, 1, 40)
			await insShape.run(
				hotelId,
				floor,
				SHAPE_KINDS.includes(s.kind) ? s.kind : "other",
				s.label ? String(s.label).slice(0, 60) : null,
				clamp(s.x, 0, 200),
				clamp(s.y, 0, 200),
				w,
				h,
				normCells(s.cells, w, h),
			)
		}
	})
	res.json({ ok: true })
})

const ROLES = ["admin", "editor", "observer", "maintenance", "viewer"]
api.get("/users", requireRole("admin"), async (_req, res) => {
	res.json(
		await db
			.prepare(
				`SELECT u.id, u.username, u.full_name, u.role, u.resident_id, u.created_at, r.full_name AS resident_name
				 FROM users u LEFT JOIN residents r ON r.id = u.resident_id ORDER BY u.username`,
			)
			.all(),
	)
})
api.post("/users", requireRole("admin"), async (req, res) => {
	const { username, password, full_name, role } = req.body || {}
	const resident_id = role === "viewer" ? Number(req.body?.resident_id) || null : null
	if (!username || !ROLES.includes(role)) {
		return res.status(400).json({ error: "Заполните логин и роль" })
	}
	if (weakPassword(password)) return res.status(400).json({ error: `Пароль слишком короткий (мин. ${MIN_PASSWORD} символов)` })
	if (role === "viewer" && !resident_id) {
		return res.status(400).json({ error: "Для роли «Просмотр» выберите проживающего" })
	}
	try {
		const info = await db
			.prepare("INSERT INTO users (username, password_hash, full_name, role, resident_id) VALUES (?,?,?,?,?)")
			.run(username, bcrypt.hashSync(password, 10), full_name || null, role, resident_id)
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такой логин уже существует" })
	}
})
const countAdmins = async () => (await db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get()).c

api.put("/users/:id", requireRole("admin"), async (req, res) => {
	const id = Number(req.params.id)
	const target = await db.prepare("SELECT * FROM users WHERE id = ?").get(id)
	if (!target) return res.status(404).json({ error: "Пользователь не найден" })
	const { full_name, role, password } = req.body || {}
	if (role && !ROLES.includes(role)) {
		return res.status(400).json({ error: "Некорректная роль" })
	}
	if (role && role !== "admin" && target.role === "admin" && await countAdmins() <= 1) {
		return res.status(400).json({ error: "Нельзя снять права у последнего администратора" })
	}
	const nextRole = role || target.role
	const resident_id =
		nextRole === "viewer" ? (req.body?.resident_id !== undefined ? Number(req.body.resident_id) || null : target.resident_id) : null
	if (nextRole === "viewer" && !resident_id) {
		return res.status(400).json({ error: "Для роли «Просмотр» выберите проживающего" })
	}
	await db.prepare("UPDATE users SET full_name = ?, role = ?, resident_id = ? WHERE id = ?").run(
		full_name ?? target.full_name,
		nextRole,
		resident_id,
		id,
	)
	if (password !== undefined && password !== "") {
		if (weakPassword(password)) return res.status(400).json({ error: `Пароль слишком короткий (мин. ${MIN_PASSWORD} символов)` })
		await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), id)
	}
	res.json({ ok: true })
})

api.delete("/users/:id", requireRole("admin"), async (req, res) => {
	const id = Number(req.params.id)
	if (id === req.user.id) return res.status(400).json({ error: "Нельзя удалить собственную учётную запись" })
	const target = await db.prepare("SELECT role FROM users WHERE id = ?").get(id)
	if (target?.role === "admin" && await countAdmins() <= 1) {
		return res.status(400).json({ error: "Нельзя удалить последнего администратора" })
	}
	await db.prepare("DELETE FROM users WHERE id = ?").run(id)
	res.json({ ok: true })
})

async function issueAccount(resident, conn = db) {
	const existing = await conn.prepare("SELECT id, username FROM users WHERE resident_id = ?").get(resident.id)
	const password = genPassword()
	const hash = bcrypt.hashSync(password, 10)
	if (existing) {
		await conn.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hash, existing.id)
		return { username: existing.username, password, reset: true }
	}
	const username = await genUsername(resident, conn)
	await conn.prepare("INSERT INTO users (username, password_hash, full_name, role, resident_id, must_change_password) VALUES (?,?,?,'viewer',?,1)").run(
		username,
		hash,
		resident.full_name,
		resident.id,
	)
	return { username, password, reset: false }
}

api.post("/residents/:id/account", requireRole("admin"), async (req, res) => {
	const resident = await db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!resident) return res.status(404).json({ error: "Проживающий не найден" })
	const cred = await issueAccount(resident)
	res.json({ full_name: resident.full_name, ...cred })
})

api.delete("/residents/:id/account", requireRole("admin"), async (req, res) => {
	await db.prepare("DELETE FROM users WHERE resident_id = ? AND role = 'viewer'").run(req.params.id)
	res.json({ ok: true })
})

api.post("/residents/accounts/bulk", requireRole("admin"), async (req, res) => {
	const without = await db
		.prepare(
			`SELECT r.* FROM residents r
			 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.resident_id = r.id)
			 ORDER BY r.full_name`,
		)
		.all()
	const issued = []
	await db.tx(async (t) => {
		for (const r of without) issued.push({ full_name: r.full_name, ...(await issueAccount(r, t)) })
	})
	res.json({ issued })
})

const HOTEL_FIELDS = ["name", "location", "settlement", "address", "phone", "email", "check_in", "check_out", "latitude", "longitude", "description", "rules"]
api.get("/hotels", async (_req, res) => res.json(await db.prepare("SELECT * FROM hotels ORDER BY name").all()))
api.get("/hotels/:id", async (req, res) => {
	const hotel = await db.prepare("SELECT * FROM hotels WHERE id = ?").get(req.params.id)
	if (!hotel) return res.status(404).json({ error: "Гостиница не найдена" })
	hotel.amenities = await db
		.prepare("SELECT a.* FROM hotel_amenities ha JOIN amenities a ON a.id = ha.amenity_id WHERE ha.hotel_id = ? ORDER BY a.name")
		.all(hotel.id)
	hotel.places = await db.prepare("SELECT * FROM places WHERE hotel_id = ? ORDER BY name").all(hotel.id)
	hotel.info = await db.prepare("SELECT * FROM hotel_info_sections WHERE hotel_id = ? ORDER BY sort, id").all(hotel.id)
	hotel.images = await imagesFor("hotel", hotel.id)
	const rev = await db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ? AND room_id IS NULL").get(hotel.id)
	hotel.reviews_count = rev.c
	hotel.rating = rev.avg ? Math.round(rev.avg * 10) / 10 : null
	res.json(hotel)
})
api.post("/hotels", requireRole("editor"), async (req, res) => {
	const b = req.body || {}
	if (!b.name) return res.status(400).json({ error: "Укажите название" })
	const cols = HOTEL_FIELDS.join(", ")
	const ph = HOTEL_FIELDS.map(() => "?").join(", ")
	const info = await db
		.prepare(`INSERT INTO hotels (${cols}) VALUES (${ph})`)
		.run(...HOTEL_FIELDS.map((f) => b[f] || null))
	res.json({ id: info.lastInsertRowid })
})
api.put("/hotels/:id", requireRole("editor"), async (req, res) => {
	const b = req.body || {}
	// Обновляем только переданные поля: иначе частичный запрос обнулял бы всё остальное
	const fields = HOTEL_FIELDS.filter((f) => f in b)
	if (!fields.length) return res.status(400).json({ error: "Нет полей для изменения" })
	if ("name" in b && !String(b.name || "").trim()) return res.status(400).json({ error: "Укажите название" })
	const set = fields.map((f) => `${f}=?`).join(", ")
	await db.prepare(`UPDATE hotels SET ${set} WHERE id=?`).run(...fields.map((f) => b[f] || null), req.params.id)
	res.json({ ok: true })
})
api.delete("/hotels/:id", requireRole("admin"), async (req, res) => {
	const id = Number(req.params.id)
	await db.prepare("DELETE FROM images WHERE owner_type = 'hotel' AND owner_id = ?").run(id)
	await db.prepare("DELETE FROM images WHERE owner_type = 'room' AND owner_id IN (SELECT id FROM rooms WHERE hotel_id = ?)").run(id)
	await db.prepare("DELETE FROM hotels WHERE id = ?").run(id)
	res.json({ ok: true })
})

api.get("/hotels/:id/places", async (req, res) =>
	res.json(await db.prepare("SELECT * FROM places WHERE hotel_id = ? ORDER BY name").all(req.params.id)),
)
api.post("/hotels/:id/places", requireRole("editor"), async (req, res) => {
	const { name, kind, note, distance, latitude, longitude, icon } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название места" })
	const info = await db
		.prepare("INSERT INTO places (hotel_id, name, kind, note, distance, latitude, longitude, icon) VALUES (?,?,?,?,?,?,?,?)")
		.run(req.params.id, name, kind || null, note || null, distance || null, latitude || null, longitude || null, icon || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/places/:id", requireRole("editor"), async (req, res) => {
	const { name, kind, note, distance, latitude, longitude, icon } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название места" })
	await db.prepare("UPDATE places SET name=?, kind=?, note=?, distance=?, latitude=?, longitude=?, icon=? WHERE id=?").run(
		name, kind || null, note || null, distance || null, latitude || null, longitude || null, icon || null, req.params.id,
	)
	res.json({ ok: true })
})
api.delete("/places/:id", requireRole("editor"), async (req, res) => {
	await db.prepare("DELETE FROM places WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

// used_count — сколько раз удобство привязано (чтобы не удалять вслепую)
api.get("/amenities", async (_req, res) =>
	res.json(
		await db
			.prepare(
				`SELECT a.*,
					(SELECT COUNT(*) FROM room_amenities ra WHERE ra.amenity_id = a.id)
					+ (SELECT COUNT(*) FROM hotel_amenities ha WHERE ha.amenity_id = a.id) AS used_count
				 FROM amenities a ORDER BY a.name`,
			)
			.all(),
	),
)
api.post("/amenities", requireRole("editor"), async (req, res) => {
	const { name, icon, scope } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название удобства" })
	try {
		const info = await db
			.prepare("INSERT INTO amenities (name, icon, scope) VALUES (?,?,?)")
			.run(name, icon || "dot", ["room", "hotel", "both"].includes(scope) ? scope : "both")
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такое удобство уже есть" })
	}
})
api.put("/amenities/:id", requireRole("editor"), async (req, res) => {
	const { name, icon, scope } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название" })
	try {
		await db.prepare("UPDATE amenities SET name = ?, icon = ?, scope = ? WHERE id = ?").run(
			name,
			icon || "dot",
			["room", "hotel", "both"].includes(scope) ? scope : "both",
			req.params.id,
		)
		res.json({ ok: true })
	} catch {
		res.status(400).json({ error: "Такое удобство уже есть" })
	}
})
api.delete("/amenities/:id", requireRole("admin"), async (req, res) => {
	await db.prepare("DELETE FROM amenities WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})
api.put("/hotels/:id/amenities", requireRole("editor"), async (req, res) => {
	const ids = Array.isArray(req.body?.amenity_ids) ? req.body.amenity_ids.map(Number).filter(Boolean) : []
	await db.tx(async (t) => {
		await t.prepare("DELETE FROM hotel_amenities WHERE hotel_id = ?").run(req.params.id)
		const ins = t.prepare("INSERT INTO hotel_amenities (hotel_id, amenity_id) VALUES (?,?) ON CONFLICT DO NOTHING")
		for (const aid of ids) await ins.run(req.params.id, aid)
	})
	res.json({ ok: true })
})
api.put("/rooms/:id/amenities", requireRole("editor"), async (req, res) => {
	const ids = Array.isArray(req.body?.amenity_ids) ? req.body.amenity_ids.map(Number).filter(Boolean) : []
	await db.tx(async (t) => {
		await t.prepare("DELETE FROM room_amenities WHERE room_id = ?").run(req.params.id)
		const ins = t.prepare("INSERT INTO room_amenities (room_id, amenity_id) VALUES (?,?) ON CONFLICT DO NOTHING")
		for (const aid of ids) await ins.run(req.params.id, aid)
	})
	res.json({ ok: true })
})

async function addImage(ownerType, ownerId, url, res) {
	if (!url || !/^(https?:\/\/|\/uploads\/)/i.test(url)) return res.status(400).json({ error: "Укажите ссылку на изображение (http/https)" })
	const sort = (await db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 s FROM images WHERE owner_type = ? AND owner_id = ?").get(ownerType, ownerId)).s
	const info = await db.prepare("INSERT INTO images (owner_type, owner_id, url, sort) VALUES (?,?,?,?)").run(ownerType, ownerId, url, sort)
	res.json({ id: info.lastInsertRowid })
}
api.post("/hotels/:id/images", requireRole("editor"), async (req, res) => await addImage("hotel", Number(req.params.id), req.body?.url, res))
api.post("/rooms/:id/images", requireRole("editor"), async (req, res) => await addImage("room", Number(req.params.id), req.body?.url, res))
api.delete("/images/:id", requireRole("editor"), async (req, res) => {
	await db.prepare("DELETE FROM images WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/hotels/:id/reviews", async (req, res) => {
	const rev = await db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ? AND room_id IS NULL").get(req.params.id)
	const list = await db
		.prepare(
			`SELECT rv.id, rv.rating, rv.text, rv.created_at, rv.reply, rv.reply_at, rv.room_id,
				rm.number AS room_number, r.full_name AS resident_name
			 FROM reviews rv
			 LEFT JOIN residents r ON r.id = rv.resident_id
			 LEFT JOIN rooms rm ON rm.id = rv.room_id
			 WHERE rv.hotel_id = ? ORDER BY rv.created_at DESC LIMIT 50`,
		)
		.all(req.params.id)
	res.json({ count: rev.c, average: rev.avg ? Math.round(rev.avg * 10) / 10 : null, reviews: list })
})
api.delete("/reviews/:id", requireRole("editor"), async (req, res) => {
	await db.prepare("DELETE FROM reviews WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/classes", async (_req, res) =>
	res.json(
		await db
			.prepare(
				`SELECT c.*, (SELECT COUNT(*) FROM rooms r WHERE r.class_id = c.id) AS used_count
				 FROM room_classes c ORDER BY c.name`,
			)
			.all(),
	),
)
api.post("/classes", requireRole("editor"), async (req, res) => {
	try {
		const info = await db.prepare("INSERT INTO room_classes (name) VALUES (?)").run(req.body.name)
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такой класс уже есть" })
	}
})
api.put("/classes/:id", requireRole("editor"), async (req, res) => {
	const name = (req.body?.name || "").trim()
	if (!name) return res.status(400).json({ error: "Укажите название" })
	try {
		await db.prepare("UPDATE room_classes SET name = ? WHERE id = ?").run(name, req.params.id)
		res.json({ ok: true })
	} catch {
		res.status(400).json({ error: "Такой тип уже есть" })
	}
})
api.delete("/classes/:id", requireRole("admin"), async (req, res) => {
	await db.prepare("DELETE FROM room_classes WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/statuses", async (_req, res) =>
	res.json(
		await db
			.prepare(
				`SELECT s.*, (SELECT COUNT(*) FROM placements p WHERE p.status_id = s.id) AS used_count
				 FROM statuses s ORDER BY s.sort, s.id`,
			)
			.all(),
	),
)
api.post("/statuses", requireRole("editor"), async (req, res) => {
	const { name, color, sort } = req.body || {}
	if (!name || !color) return res.status(400).json({ error: "Укажите название и цвет" })
	const stage = STAGES.includes(req.body?.stage) ? req.body.stage : null
	try {
		const info = await db.prepare("INSERT INTO statuses (name, color, sort, kind, stage) VALUES (?,?,?,'booking',?)").run(name, color, sort || 0, stage)
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: stage ? "Такой статус уже есть, или стадия уже привязана к другому статусу" : "Такой статус уже есть" })
	}
})
api.put("/statuses/:id", requireRole("editor"), async (req, res) => {
	const { name, color, sort } = req.body || {}
	if (!name || !color) return res.status(400).json({ error: "Укажите название и цвет" })
	// Системным состояниям можно поменять подпись и цвет, но не превратить их в статус брони
	await db.prepare("UPDATE statuses SET name = ?, color = ?, sort = ? WHERE id = ?").run(name, color, sort || 0, req.params.id)
	// Привязка к стадии: у одной стадии — один статус, старую привязку снимаем
	if (req.body && "stage" in req.body && !(await systemStatus(req.params.id))) {
		const stage = STAGES.includes(req.body.stage) ? req.body.stage : null
		await db.tx(async (t) => {
			if (stage) await t.prepare("UPDATE statuses SET stage = NULL WHERE stage = ? AND id <> ?").run(stage, req.params.id)
			await t.prepare("UPDATE statuses SET stage = ? WHERE id = ?").run(stage, req.params.id)
		})
	}
	res.json({ ok: true })
})
api.delete("/statuses/:id", requireRole("admin"), async (req, res) => {
	if (await systemStatus(req.params.id)) {
		return res.status(400).json({ error: "Системное состояние удалить нельзя — можно изменить название и цвет" })
	}
	try {
		await db.prepare("DELETE FROM statuses WHERE id = ?").run(req.params.id)
		res.json({ ok: true })
	} catch {
		res.status(400).json({ error: "Статус используется в размещениях" })
	}
})

api.get("/rooms", async (req, res) => {
	const filters = []
	const args = []
	if (req.query.hotel_id) {
		filters.push("r.hotel_id = ?")
		args.push(req.query.hotel_id)
	}
	if (req.query.class_id) {
		filters.push("r.class_id = ?")
		args.push(req.query.class_id)
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
	const rooms = await db
		.prepare(
			`SELECT r.*, h.name AS hotel_name, c.name AS class_name
			 FROM rooms r
			 JOIN hotels h ON h.id = r.hotel_id
			 LEFT JOIN room_classes c ON c.id = r.class_id
			 ${where} ORDER BY r.floor, r.number`,
		)
		.all(...args)
	const bedsStmt = db.prepare("SELECT * FROM beds WHERE room_id = ? ORDER BY id")
	const amenStmt = db.prepare("SELECT amenity_id FROM room_amenities WHERE room_id = ?")
	for (const room of rooms) {
		room.beds = await bedsStmt.all(room.id)
		room.amenity_ids = (await amenStmt.all(room.id)).map((r) => r.amenity_id)
		room.images = await imagesFor("room", room.id)
	}
	res.json(rooms)
})

api.post("/rooms", requireRole("editor"), async (req, res) => {
	const { hotel_id, class_id, number, floor, capacity, description } = req.body || {}
	if (!hotel_id || !number) return res.status(400).json({ error: "Гостиница и номер обязательны" })
	const cap = Math.max(1, parseInt(capacity, 10) || 1)
	const roomId = await db.tx(async (t) => {
		const info = await t
			.prepare("INSERT INTO rooms (hotel_id, class_id, number, floor, capacity, description) VALUES (?,?,?,?,?,?)")
			.run(hotel_id, class_id || null, number, floor || null, cap, description || null)
		const bed = t.prepare("INSERT INTO beds (room_id, label) VALUES (?,?)")
		for (let i = 1; i <= cap; i++) await bed.run(info.lastInsertRowid, `Место ${i}`)
		return info.lastInsertRowid
	})
	res.json({ id: roomId })
})

api.put("/rooms/:id", requireRole("editor"), async (req, res) => {
	const { class_id, number, floor, capacity, description } = req.body || {}
	const cap = Math.max(1, parseInt(capacity, 10) || 1)
	const beds = await db.prepare("SELECT * FROM beds WHERE room_id = ? ORDER BY id").all(req.params.id)

	// Уменьшение вместимости: лишние места убираем с конца, но только пустые.
	// Если на них есть непогашенные брони — операцию отклоняем, иначе бронь исчезла бы молча.
	const extra = beds.length > cap ? beds.slice(cap) : []
	if (extra.length) {
		const cnt = db.prepare("SELECT COUNT(*) c FROM placements WHERE bed_id = ? AND stage <> 'cancelled'")
		const busy = []
		for (const b of extra) {
			if ((await cnt.get(b.id)).c > 0) busy.push(b)
		}
		if (busy.length) {
			return res.status(409).json({
				error: `Нельзя уменьшить вместимость: на местах «${busy.map((b) => b.label).join("», «")}» есть брони. Сначала отмените или перенесите их.`,
			})
		}
	}

	await db.tx(async (t) => {
		await t.prepare("UPDATE rooms SET class_id=?, number=?, floor=?, capacity=?, description=? WHERE id=?").run(
			class_id || null,
			number,
			floor || null,
			cap,
			description || null,
			req.params.id,
		)
		if (beds.length < cap) {
			const ins = t.prepare("INSERT INTO beds (room_id, label) VALUES (?,?)")
			for (let i = beds.length + 1; i <= cap; i++) await ins.run(req.params.id, `Место ${i}`)
		} else if (extra.length) {
			const del = t.prepare("DELETE FROM beds WHERE id = ?")
			for (const b of extra) await del.run(b.id)
		}
	})
	res.json({ ok: true })
})

api.delete("/rooms/:id", requireRole("editor"), async (req, res) => {
	const id = Number(req.params.id)
	// Удаление каскадом сносит места и брони. Текущие и будущие брони так терять нельзя.
	const today = todayStr()
	const active = (await db
		.prepare(
			`SELECT COUNT(*) c FROM placements p JOIN beds b ON b.id = p.bed_id
			 WHERE b.room_id = ? AND p.stage <> 'cancelled' AND p.date_to >= ?`,
		)
		.get(id, today)).c
	if (active) {
		return res.status(409).json({
			error: `В номере есть действующие или будущие брони (${active}). Отмените их либо поставьте номер на ремонт вместо удаления.`,
		})
	}
	await db.prepare("DELETE FROM images WHERE owner_type = 'room' AND owner_id = ?").run(id)
	await db.prepare("DELETE FROM rooms WHERE id = ?").run(id)
	res.json({ ok: true })
})

api.get("/availability", async (req, res) => {
	const { from, to } = req.query
	if (!from || !to) return res.status(400).json({ error: "Укажите период" })
	if (to < from) return res.status(400).json({ error: "Дата выезда раньше даты заезда" })
	const filters = []
	const args = []
	if (req.query.hotel_id) {
		filters.push("rm.hotel_id = ?")
		args.push(req.query.hotel_id)
	}
	if (req.query.class_id) {
		filters.push("rm.class_id = ?")
		args.push(req.query.class_id)
	}
	const where = filters.length ? `AND ${filters.join(" AND ")}` : ""
	const rows = await db
		.prepare(
			`SELECT b.id AS bed_id, b.label AS bed_label,
				rm.id AS room_id, rm.number, rm.floor, rm.capacity, rm.description,
				c.name AS class_name, h.id AS hotel_id, h.name AS hotel_name
			 FROM beds b
			 JOIN rooms rm ON rm.id = b.room_id
			 JOIN hotels h ON h.id = rm.hotel_id
			 LEFT JOIN room_classes c ON c.id = rm.class_id
			 WHERE NOT EXISTS (
				SELECT 1 FROM placements p WHERE p.bed_id = b.id AND p.stage <> 'cancelled' AND p.date_from < ? AND p.date_to > ?
			 )
			 AND NOT EXISTS (
				SELECT 1 FROM room_blocks rb WHERE rb.room_id = rm.id AND rb.date_from < ? AND rb.date_to >= ?
			 )
			 ${where}
			 ORDER BY h.name, rm.floor, rm.number, b.id`,
		)
		.all(to, from, to, from, ...args)
	const roomsMap = new Map()
	for (const r of rows) {
		if (!roomsMap.has(r.room_id))
			roomsMap.set(r.room_id, {
				room_id: r.room_id,
				number: r.number,
				floor: r.floor,
				capacity: r.capacity,
				class_name: r.class_name,
				hotel_id: r.hotel_id,
				hotel_name: r.hotel_name,
				free_beds: [],
			})
		roomsMap.get(r.room_id).free_beds.push({ bed_id: r.bed_id, bed_label: r.bed_label })
	}
	const rooms = [...roomsMap.values()]
	res.json({
		from,
		to,
		totals: { free_beds: rows.length, rooms_with_space: rooms.length, fully_free_rooms: rooms.filter((r) => r.free_beds.length >= r.capacity).length },
		rooms,
	})
})

api.get("/rooms/:id/blocks", async (req, res) =>
	res.json(await db.prepare("SELECT * FROM room_blocks WHERE room_id = ? ORDER BY date_from DESC").all(req.params.id)),
)
api.post("/rooms/:id/blocks", requireRepair, async (req, res) => {
	const { date_from, date_to, reason } = req.body || {}
	if (!date_from || !date_to) return res.status(400).json({ error: "Укажите период ремонта" })
	if (date_to < date_from) return res.status(400).json({ error: "Дата окончания раньше начала" })
	if (!await db.prepare("SELECT id FROM rooms WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "Номер не найден" })
	// Ремонт снимает с продажи весь номер, поэтому уже стоящие на эти ночи брони надо
	// сначала перенести — иначе человек окажется в номере, которого «нет».
	const busy = (await db
		.prepare(
			`SELECT COUNT(*) c FROM placements p JOIN beds b ON b.id = p.bed_id
			 WHERE b.room_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ?`,
		)
		.get(req.params.id, date_to, date_from)).c
	if (busy) {
		return res.status(409).json({ error: `На эти даты в номере есть брони (${busy}). Перенесите или отмените их перед ремонтом.` })
	}
	const info = await db
		.prepare("INSERT INTO room_blocks (room_id, date_from, date_to, reason) VALUES (?,?,?,?)")
		.run(req.params.id, date_from, date_to, reason || null)
	broadcastToStaff("rack:changed", { hotelId: await roomHotelId(req.params.id) })
	res.json({ id: info.lastInsertRowid })
})
api.delete("/blocks/:id", requireRepair, async (req, res) => {
	const block = await db.prepare("SELECT room_id FROM room_blocks WHERE id = ?").get(req.params.id)
	await db.prepare("DELETE FROM room_blocks WHERE id = ?").run(req.params.id)
	broadcastToStaff("rack:changed", { hotelId: await roomHotelId(block?.room_id) })
	res.json({ ok: true })
})

api.get("/residents", async (req, res) => {
	const q = `%${req.query.q || ""}%`
	const today = todayStr()
	// Где человек живёт сегодня — чтобы в списке на сотни людей сразу видеть и фильтровать
	res.json(
		await db
			.prepare(
				`SELECT r.*, u.username AS account_username, u.must_change_password AS account_must_change,
					cur.hotel_id AS stay_hotel_id, cur.place AS stay_place, cur.date_to AS stay_to
				 FROM residents r
				 LEFT JOIN users u ON u.resident_id = r.id AND u.role = 'viewer'
				 LEFT JOIN LATERAL (
					SELECT rm.hotel_id, h.name || ' · № ' || rm.number AS place, p.date_to
					FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hotels h ON h.id = rm.hotel_id
					WHERE p.resident_id = r.id AND p.stage IN ('expected', 'checked_in') AND p.date_from <= ? AND p.date_to > ?
					ORDER BY p.date_from DESC LIMIT 1
				 ) cur ON TRUE
				 WHERE r.full_name ILIKE ? OR r.tab_number ILIKE ? ORDER BY r.full_name`,
			)
			.all(today, today, q, q),
	)
})
api.get("/residents/:id/card", async (req, res) => {
	const resident = await db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!resident) return res.status(404).json({ error: "Проживающий не найден" })
	const stays = await db
		.prepare(
			`SELECT p.date_from, p.date_to, p.comment, p.stage,
				s.name AS status_name, s.color AS status_color,
				b.label AS bed_label, rm.number AS room_number, h.name AS hotel_name
			 FROM placements p
			 JOIN beds b ON b.id = p.bed_id
			 JOIN rooms rm ON rm.id = b.room_id
			 JOIN hotels h ON h.id = rm.hotel_id
			 JOIN statuses s ON s.id = p.status_id
			 WHERE p.resident_id = ? ORDER BY p.date_from DESC`,
		)
		.all(req.params.id)
	res.json({ resident, stays })
})

api.post("/residents", requireRole("editor"), async (req, res) => {
	const { full_name, tab_number, company, department, position, phone, note } = req.body || {}
	if (!full_name) return res.status(400).json({ error: "Укажите ФИО" })
	const info = await db
		.prepare("INSERT INTO residents (full_name, tab_number, company, department, position, phone, note) VALUES (?,?,?,?,?,?,?)")
		.run(full_name, tab_number || null, company || null, department || null, position || null, phone || null, note || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/residents/:id", requireRole("editor"), async (req, res) => {
	const { full_name, tab_number, company, department, position, phone, note } = req.body || {}
	const current = await db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Проживающий не найден" })
	const nextName = full_name !== undefined ? String(full_name).trim() : current.full_name
	if (!nextName) return res.status(400).json({ error: "Укажите ФИО" })
	await db.prepare(
		"UPDATE residents SET full_name=?, tab_number=?, company=?, department=?, position=?, phone=?, note=? WHERE id=?",
	).run(
		nextName,
		tab_number !== undefined ? tab_number || null : current.tab_number,
		company !== undefined ? company || null : current.company,
		department !== undefined ? department || null : current.department,
		position !== undefined ? position || null : current.position,
		phone !== undefined ? phone || null : current.phone,
		note !== undefined ? note || null : current.note,
		req.params.id,
	)
	await db.prepare("UPDATE users SET full_name = ? WHERE resident_id = ? AND role = 'viewer'").run(nextName, req.params.id)
	res.json({ ok: true })
})
// Снять неподходящее фото профиля (сам вахтовик потом может поставить другое)
api.delete("/residents/:id/photo", requireRole("editor"), async (req, res) => {
	await db.prepare("UPDATE residents SET photo = NULL WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})
api.delete("/residents/:id", requireRole("editor"), async (req, res) => {
	const id = req.params.id
	await db.tx(async (t) => {
		await t.prepare("DELETE FROM users WHERE resident_id = ? AND role = 'viewer'").run(id)
		await t.prepare("DELETE FROM reviews WHERE resident_id = ?").run(id)
		await t.prepare("DELETE FROM placements WHERE resident_id = ?").run(id)
		await t.prepare("DELETE FROM residents WHERE id = ?").run(id)
	})
	res.json({ ok: true })
})

const placementSelect = `
	SELECT p.*, r.full_name AS resident_name, s.name AS status_name, s.color AS status_color
	FROM placements p
	LEFT JOIN residents r ON r.id = p.resident_id
	JOIN statuses s ON s.id = p.status_id`

api.get("/placements", async (req, res) => {
	const args = []
	const filters = []
	if (req.query.from && req.query.to) {
		filters.push("p.date_from <= ? AND p.date_to > ?")
		args.push(req.query.to, req.query.from)
	}
	if (req.query.bed_id) {
		filters.push("p.bed_id = ?")
		args.push(req.query.bed_id)
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
	res.json(await db.prepare(`${placementSelect} ${where} ORDER BY p.date_from`).all(...args))
})

api.get("/rack", async (req, res) => {
	const { hotel_id, from, to } = req.query
	if (!hotel_id || !from || !to) return res.status(400).json({ error: "Укажите гостиницу и период" })
	const rooms = await db
		.prepare(
			`SELECT r.id, r.number, r.floor, c.name AS class_name
			 FROM rooms r LEFT JOIN room_classes c ON c.id = r.class_id
			 WHERE r.hotel_id = ? ORDER BY r.floor, r.number`,
		)
		.all(hotel_id)
	// Места всех номеров одним запросом: запрос на каждый номер в доме на сотни мест
	// превращал каждое обновление шахматки в сотни обращений к базе
	const beds = await db
		.prepare("SELECT b.id, b.label, b.room_id FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.hotel_id = ? ORDER BY b.id")
		.all(hotel_id)
	const byRoom = new Map(rooms.map((r) => [r.id, (r.beds = [])]))
	for (const b of beds) byRoom.get(b.room_id)?.push({ id: b.id, label: b.label })
	const placements = await db
		.prepare(
			`${placementSelect}
			 JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
			 WHERE rm.hotel_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ?
			 ORDER BY p.date_from`,
		)
		.all(hotel_id, to, from)
	const blocks = await db
		.prepare(
			`SELECT rb.id, rb.room_id, rb.date_from, rb.date_to, rb.reason
			 FROM room_blocks rb JOIN rooms rm ON rm.id = rb.room_id
			 WHERE rm.hotel_id = ? AND rb.date_from <= ? AND rb.date_to >= ?`,
		)
		.all(hotel_id, to, from)
	res.json({ rooms, placements, blocks })
})

// Пересечение считаем по «полудням»: день выезда свободен для нового заезда (пересменка).
// Брони [a1,a2] и [b1,b2] конфликтуют ⟺ a1 < b2 И b1 < a2. Отменённые не блокируют.
async function findConflict(bedId, from, to, excludeId) {
	return await db
		.prepare(
			`SELECT p.date_from, p.date_to, COALESCE(r.full_name, s.name) AS who
			 FROM placements p
			 JOIN statuses s ON s.id = p.status_id
			 LEFT JOIN residents r ON r.id = p.resident_id
			 WHERE p.bed_id = ? AND p.id <> ? AND p.stage <> 'cancelled' AND p.date_from < ? AND p.date_to > ?
			 LIMIT 1`,
		)
		.get(bedId, excludeId || 0, to, from)
}

// Ремонт [X,Y] делает номер недоступным по ночь Y включительно, то есть занимает [X, Y+1).
// Бронь [from,to) пересекается с ним ⟺ X < to И from <= Y: ремонт, начинающийся в день
// выезда, брони не мешает — человек к этому моменту уже съехал.
async function findBlock(bedId, from, to) {
	return await db
		.prepare(
			`SELECT rb.date_from, rb.date_to, rb.reason
			 FROM room_blocks rb
			 JOIN beds b ON b.room_id = rb.room_id
			 WHERE b.id = ? AND rb.date_from < ? AND rb.date_to >= ?
			 LIMIT 1`,
		)
		.get(bedId, to, from)
}

// Статус, привязанный к стадии (цвет ленты). Нет привязки — null.
const statusForStage = async (stage) => (await db.prepare("SELECT id FROM statuses WHERE stage = ?").get(stage))?.id ?? null
// Какой статус поставить брони: свой (метка без привязки к стадии) — оставляем,
// иначе берём привязанный к стадии; нет и его — первый статус брони.
async function resolveStatus(statusId, stage) {
	if (statusId) {
		const s = await db.prepare("SELECT stage, kind FROM statuses WHERE id = ?").get(statusId)
		if (s && s.kind === "booking" && !s.stage) return statusId
	}
	return (
		(await statusForStage(stage)) ||
		statusId ||
		(await db.prepare("SELECT id FROM statuses WHERE kind = 'booking' ORDER BY sort, id LIMIT 1").get())?.id ||
		null
	)
}

api.post("/placements", requireRole("editor"), async (req, res) => {
	const { bed_id, resident_id, date_from, date_to, comment } = req.body || {}
	const stage = req.body?.stage || "expected"
	const status_id = await resolveStatus(req.body?.status_id, stage)
	if (stage !== "cancelled" && !resident_id) return res.status(400).json({ error: "Выберите или создайте профиль вахтовика" })
	if (resident_id && !await db.prepare("SELECT id FROM residents WHERE id = ?").get(resident_id)) {
		return res.status(400).json({ error: "Профиль вахтовика не найден" })
	}
	if (!bed_id || !status_id || !date_from || !date_to) {
		return res.status(400).json({ error: "Заполните место, статус и даты" })
	}
	if (!STAGES.includes(stage)) return res.status(400).json({ error: "Неизвестная стадия брони" })
	const sysNew = await systemStatus(status_id)
	if (sysNew) return res.status(400).json({ error: systemStatusError(sysNew) })
	if (!(nights(date_from, date_to) >= 1)) return res.status(400).json({ error: "Выезд должен быть позже заезда: бронь — минимум одна ночь" })
	const conflict = await findConflict(bed_id, date_from, date_to)
	if (conflict) {
		return res.status(409).json({
			error: `Место занято: ${conflict.who} (${conflict.date_from} – ${conflict.date_to})`,
		})
	}
	const block = await findBlock(bed_id, date_from, date_to)
	if (block) {
		return res.status(409).json({ error: `Номер на ремонте: ${block.date_from} – ${block.date_to}${block.reason ? ` · ${block.reason}` : ""}` })
	}
	const info = await db
		.prepare("INSERT INTO placements (bed_id, resident_id, status_id, stage, date_from, date_to, comment) VALUES (?,?,?,?,?,?,?)")
		.run(bed_id, resident_id || null, status_id, stage, date_from, date_to, comment || null)
	broadcastToStaff("rack:changed", { hotelId: await bedHotelId(bed_id) })
	res.json({ id: info.lastInsertRowid })
})
api.put("/placements/:id", requireRole("editor"), async (req, res) => {
	const { resident_id, date_from, date_to, comment } = req.body || {}
	if (!date_from || !date_to) return res.status(400).json({ error: "Заполните даты" })
	if (!(nights(date_from, date_to) >= 1)) return res.status(400).json({ error: "Выезд должен быть позже заезда: бронь — минимум одна ночь" })
	const current = await db.prepare("SELECT bed_id, stage FROM placements WHERE id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Размещение не найдено" })
	// Перенос брони на другое место (перетаскивание в календаре броней)
	const bedId = req.body?.bed_id ? Number(req.body.bed_id) : current.bed_id
	if (bedId !== current.bed_id && !await db.prepare("SELECT id FROM beds WHERE id = ?").get(bedId)) {
		return res.status(400).json({ error: "Место не найдено" })
	}
	const stage = req.body?.stage || current.stage
	if (stage !== "cancelled" && !resident_id) return res.status(400).json({ error: "Выберите или создайте профиль вахтовика" })
	if (resident_id && !await db.prepare("SELECT id FROM residents WHERE id = ?").get(resident_id)) {
		return res.status(400).json({ error: "Профиль вахтовика не найден" })
	}
	if (!STAGES.includes(stage)) return res.status(400).json({ error: "Неизвестная стадия брони" })
	const status_id = await resolveStatus(req.body?.status_id, stage)
	if (!status_id) return res.status(400).json({ error: "Нет ни одного статуса брони — заведите его в справочниках" })
	const sysUpd = await systemStatus(status_id)
	if (sysUpd) return res.status(400).json({ error: systemStatusError(sysUpd) })
	// В карточке брони состояние выбирают осознанно — разрешаем любое (например, внести
	// задним числом «Выехал» или вернуть ошибочно отменённую). Быстрые кнопки в шахматке
	// идут через /stage и там переходы по-прежнему строгие.
	const conflict = await findConflict(bedId, date_from, date_to, req.params.id)
	if (conflict) {
		return res.status(409).json({
			error: `Место занято: ${conflict.who} (${conflict.date_from} – ${conflict.date_to})`,
		})
	}
	if (stage !== "cancelled") {
		const block = await findBlock(bedId, date_from, date_to)
		if (block) return res.status(409).json({ error: `Номер на ремонте: ${block.date_from} – ${block.date_to}${block.reason ? ` · ${block.reason}` : ""}` })
	}
	await db.prepare("UPDATE placements SET bed_id=?, resident_id=?, status_id=?, stage=?, date_from=?, date_to=?, comment=? WHERE id=?").run(
		bedId,
		resident_id || null,
		status_id,
		stage,
		date_from,
		date_to,
		comment || null,
		req.params.id,
	)
	broadcastToStaff("rack:changed", { hotelId: await bedHotelId(bedId) })
	res.json({ ok: true })
})
api.post("/placements/:id/stage", requireRole("editor"), async (req, res) => {
	const stage = req.body?.stage
	if (!STAGES.includes(stage)) return res.status(400).json({ error: "Неизвестная стадия брони" })
	const current = await db.prepare("SELECT p.stage, b.room_id FROM placements p JOIN beds b ON b.id = p.bed_id WHERE p.id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Размещение не найдено" })
	if (!canTransition(current.stage, stage)) {
		return res.status(409).json({ error: "Недопустимый переход стадии брони" })
	}
	// Вместе со стадией меняется и цвет, если у брони стандартный (привязанный) статус
	const cur = await db.prepare("SELECT status_id FROM placements WHERE id = ?").get(req.params.id)
	const statusId = await resolveStatus(cur.status_id, stage)
	await db.prepare("UPDATE placements SET stage = ?, status_id = ? WHERE id = ?").run(stage, statusId, req.params.id)
	broadcastToStaff("rack:changed", { hotelId: await roomHotelId(current.room_id) })
	res.json({ ok: true })
})
api.delete("/placements/:id", requireRole("editor"), async (req, res) => {
	const placement = await db.prepare("SELECT b.room_id FROM placements p JOIN beds b ON b.id = p.bed_id WHERE p.id = ?").get(req.params.id)
	await db.prepare("DELETE FROM placements WHERE id = ?").run(req.params.id)
	broadcastToStaff("rack:changed", { hotelId: await roomHotelId(placement?.room_id) })
	res.json({ ok: true })
})

api.get("/report/room/:id", async (req, res) => {
	const room = await db
		.prepare(
			`SELECT r.*, h.name AS hotel_name, c.name AS class_name FROM rooms r
			 JOIN hotels h ON h.id = r.hotel_id LEFT JOIN room_classes c ON c.id = r.class_id WHERE r.id = ?`,
		)
		.get(req.params.id)
	if (!room) return res.status(404).json({ error: "Номер не найден" })
	const rows = await db
		.prepare(
			`${placementSelect} JOIN beds b ON b.id = p.bed_id WHERE b.room_id = ? ORDER BY p.date_from`,
		)
		.all(req.params.id)
	const data = rows.map((r) => ({
		Статус: r.status_name,
		"Стадия": stageLabel(r.stage),
		Проживающий: r.resident_name || "—",
		"Заезд": r.date_from,
		"Выезд": r.date_to,
		Комментарий: r.comment || "",
	}))
	await sendXlsx(res, data, `room_${room.number}`, [
		[`Отчёт по номеру ${room.number} (${room.hotel_name})`],
		[`Класс: ${room.class_name || "—"}, мест: ${room.capacity}`],
		[],
	])
})

api.get("/report/resident/:id", async (req, res) => {
	const person = await db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!person) return res.status(404).json({ error: "Проживающий не найден" })
	const rows = await db
		.prepare(
			`SELECT p.date_from, p.date_to, p.comment, p.stage, s.name AS status_name,
				rm.number AS room_number, h.name AS hotel_name, b.label AS bed_label
			 FROM placements p
			 JOIN beds b ON b.id = p.bed_id
			 JOIN rooms rm ON rm.id = b.room_id
			 JOIN hotels h ON h.id = rm.hotel_id
			 JOIN statuses s ON s.id = p.status_id
			 WHERE p.resident_id = ? ORDER BY p.date_from`,
		)
		.all(req.params.id)
	const data = rows.map((r) => ({
		Гостиница: r.hotel_name,
		Номер: r.room_number,
		Место: r.bed_label,
		Статус: r.status_name,
		"Стадия": stageLabel(r.stage),
		"Заезд": r.date_from,
		"Выезд": r.date_to,
		Комментарий: r.comment || "",
	}))
	await sendXlsx(res, data, `resident_${person.id}`, [
		[`Отчёт по проживающему: ${person.full_name}`],
		[`Таб. №: ${person.tab_number || "—"}, организация: ${person.company || "—"}`],
		[],
	])
})

// Импорт кадровой выгрузки. Два шага: ?dry=1 — только разбор и план (что добавится,
// что обновится, что пропущено), без записи; без dry — то же самое, но с записью.
// Оператор видит план до того, как в базе что-то поменялось.
api.post("/import/residents", requireRole("editor"), upload.single("file"), async (req, res) => {
	if (!req.file) return res.status(400).json({ error: "Файл не получен" })
	const dry = req.query.dry === "1"
	const wb = new ExcelJS.Workbook()
	try {
		await wb.xlsx.load(req.file.buffer)
	} catch {
		return res.status(400).json({ error: "Не удалось прочитать файл. Нужен Excel в формате .xlsx" })
	}
	const ws = wb.worksheets[0]
	if (!ws) return res.status(400).json({ error: "В файле нет листов" })

	const cellText = (cell) => {
		const v = cell?.value
		if (v == null) return ""
		if (typeof v === "object") return String(v.text ?? v.result ?? v.richText?.map((p) => p.text).join("") ?? "").trim()
		return String(v).trim()
	}

	// Приводим лист к простым массивам строк: разбор колонок вынесен в отдельный
	// модуль и про ExcelJS ничего не знает.
	const width = ws.columnCount
	const readRow = (row) => {
		const out = []
		for (let c = 1; c <= width; c++) out.push(cellText(row.getCell(c)))
		return out
	}
	const headers = readRow(ws.getRow(1))
	const rows = []
	ws.eachRow((row, n) => {
		if (n > 1) {
			const values = readRow(row)
			if (values.some(Boolean)) rows.push({ line: n, values })
		}
	})
	if (!rows.length) return res.status(400).json({ error: "В файле нет строк с данными" })

	const cols = detectColumns(headers, rows.map((r) => r.values))
	if (cols.name < 0) {
		return res.status(400).json({
			error: "Не удалось найти колонку с ФИО. Нужен лист, где в одной из колонок записаны фамилия, имя и отчество.",
		})
	}
	const at = (row, idx) => (idx >= 0 ? String(row[idx] ?? "").trim() : "")
	const FIELDS = ["company", "department", "position", "phone", "note"]
	const LABEL = { company: "Организация", department: "Подразделение", position: "Должность", phone: "Телефон", note: "Примечание" }
	const nameKey = (s) => s.trim().toLowerCase().replace(/ё/g, "е")

	// Кого уже знаем: по табельному, а без него — по ФИО (если такое ФИО одно),
	// иначе повторная выгрузка без табельных плодила бы дубли.
	const known = await db.prepare("SELECT id, full_name, tab_number, company, department, position, phone, note FROM residents").all()
	const byTab = new Map(known.filter((r) => r.tab_number).map((r) => [String(r.tab_number).trim(), r]))
	const byName = new Map()
	for (const r of known) byName.set(nameKey(r.full_name), byName.has(nameKey(r.full_name)) ? null : r) // null — тёзки

	const plan = []
	const seenTabs = new Set()
	for (const { line, values } of rows) {
		const rawName = at(values, cols.name)
		// Строки без ФИО — подписи, итоги и пустые разделители.
		if (!isFio(rawName)) {
			if (rawName) plan.push({ action: "skip", line, name: rawName, reason: "не похоже на ФИО" })
			continue
		}
		const rec = { full_name: titleCase(rawName), tab_number: at(values, cols.tab) || null }
		for (const f of FIELDS) rec[f] = at(values, cols[f]) || null
		if (rec.tab_number && seenTabs.has(rec.tab_number)) {
			plan.push({ action: "skip", line, name: rec.full_name, reason: `табельный ${rec.tab_number} уже был выше в файле` })
			continue
		}
		if (rec.tab_number) seenTabs.add(rec.tab_number)

		const match = (rec.tab_number && byTab.get(rec.tab_number)) || byName.get(nameKey(rec.full_name)) || null
		if (!match) {
			plan.push({ action: "new", line, name: rec.full_name, rec })
			continue
		}
		// Пустое поле в файле не затирает введённое вручную (телефоны, заметки)
		const changes = []
		if (match.full_name !== rec.full_name) changes.push({ field: "ФИО", from: match.full_name, to: rec.full_name })
		if (!match.tab_number && rec.tab_number) changes.push({ field: "Таб. №", from: null, to: rec.tab_number })
		for (const f of FIELDS) if (rec[f] && rec[f] !== match[f]) changes.push({ field: LABEL[f], from: match[f], to: rec[f] })
		plan.push({ action: changes.length ? "update" : "same", line, name: rec.full_name, id: match.id, rec, changes })
	}

	if (!dry) {
		await db.tx(async (t) => {
			const ins = t.prepare("INSERT INTO residents (full_name, tab_number, company, department, position, phone, note) VALUES (?,?,?,?,?,?,?)")
			const upd = t.prepare(
				`UPDATE residents SET full_name = ?, tab_number = COALESCE(tab_number, ?),
					company = COALESCE(?, company), department = COALESCE(?, department), position = COALESCE(?, position),
					phone = COALESCE(?, phone), note = COALESCE(?, note)
				 WHERE id = ?`,
			)
			for (const p of plan) {
				const r = p.rec
				if (p.action === "new") await ins.run(r.full_name, r.tab_number, r.company, r.department, r.position, r.phone, r.note)
				if (p.action === "update") await upd.run(r.full_name, r.tab_number, r.company, r.department, r.position, r.phone, r.note, p.id)
			}
		})
	}

	const label = (idx) => (idx >= 0 ? headers[idx] || `колонка ${idx + 1}` : null)
	const count = (a) => plan.filter((p) => p.action === a).length
	res.json({
		dry,
		rows: rows.length,
		imported: count("new"),
		updated: count("update"),
		same: count("same"),
		skipped: count("skip"),
		columns: {
			"ФИО": label(cols.name),
			"Таб. №": label(cols.tab),
			"Организация": label(cols.company),
			"Подразделение": label(cols.department),
			"Должность": label(cols.position),
			"Телефон": label(cols.phone),
		},
		plan: plan.map(({ rec, ...p }) => ({ ...p, tab: rec?.tab_number || null, department: rec?.department || null, position: rec?.position || null })),
	})
})

// Выгрузка проживающих в том же виде, в каком их принимает импорт: файл можно
// поправить в Excel и загрузить обратно — сопоставление пойдёт по табельному.
api.get("/export/residents", async (req, res) => {
	const today = todayStr()
	const list = await db
		.prepare(
			`SELECT r.*, u.username AS account,
				(SELECT h.name || ' · № ' || rm.number || ' · ' || b.label || '|' || p.date_from || '|' || p.date_to
				 FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hotels h ON h.id = rm.hotel_id
				 WHERE p.resident_id = r.id AND p.stage IN ('expected', 'checked_in') AND p.date_from <= ? AND p.date_to > ?
				 ORDER BY p.date_from DESC LIMIT 1) AS stay
			 FROM residents r LEFT JOIN users u ON u.resident_id = r.id AND u.role = 'viewer'
			 ORDER BY r.full_name`,
		)
		.all(today, today)

	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("Проживающие", { views: [{ state: "frozen", ySplit: 1 }] })
	ws.columns = [
		{ header: "Таб.№", key: "tab", width: 12 },
		{ header: "ФИО", key: "name", width: 34 },
		{ header: "Должность", key: "position", width: 34 },
		{ header: "Подразделение", key: "department", width: 38 },
		{ header: "Организация", key: "company", width: 18 },
		{ header: "Телефон", key: "phone", width: 18 },
		{ header: "Доступ в кабинет", key: "account", width: 18 },
		{ header: "Проживает сейчас", key: "place", width: 36 },
		{ header: "Заезд", key: "from", width: 12 },
		{ header: "Выезд", key: "to", width: 12 },
		{ header: "Примечание", key: "note", width: 30 },
	]
	const ru = (d) => (d ? d.split("-").reverse().join(".") : "")
	for (const r of list) {
		const [place, f, t] = (r.stay || "").split("|")
		ws.addRow({
			tab: r.tab_number || "",
			name: r.full_name,
			position: r.position || "",
			department: r.department || "",
			company: r.company || "",
			phone: r.phone || "",
			account: r.account || "",
			place: place || "",
			from: ru(f),
			to: ru(t),
			note: r.note || "",
		})
	}
	const head = ws.getRow(1)
	head.font = { bold: true, color: { argb: "FFFFFFFF" } }
	head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D3FC0" } }
	head.alignment = { vertical: "middle" }
	head.height = 22
	ws.autoFilter = { from: "A1", to: "K1" }
	await sendWorkbook(res, wb, `Проживающие_${ru(today)}`)
})

api.get("/rooms/:id/issues", async (req, res) => {
	try {
		const issues = await db.prepare(`
			SELECT ri.*, u.full_name as user_name 
			FROM room_issues ri
			LEFT JOIN users u ON u.id = ri.user_id
			WHERE ri.room_id = ?
			ORDER BY ri.id DESC
		`).all(req.params.id);
		res.json(issues)
	} catch (e) {
		console.error("GET /rooms/:id/issues:", e.message)
		res.status(500).json({ error: "Не удалось загрузить заявки по номеру" })
	}
});

// Счётчик новых заявок по всем домам — для бейджа в меню персонала
api.get("/issues/count", async (_req, res) => {
	const row = await db.prepare("SELECT COUNT(*) AS count FROM room_issues WHERE status = 'Новая'").get()
	res.json({ count: row?.count || 0 })
})

api.put("/issues/:id/status", requireRepair, async (req, res) => {
	const { status } = req.body || {}
	if (!ISSUE_STATUSES.includes(status)) {
		return res.status(400).json({ error: `Недопустимый статус заявки. Допустимые: ${ISSUE_STATUSES.join(", ")}` })
	}
	const issue = await db
		.prepare("SELECT ri.user_id, ri.room_id, ri.amenity_name, ri.status, rm.number AS room_number FROM room_issues ri JOIN rooms rm ON rm.id = ri.room_id WHERE ri.id = ?")
		.get(req.params.id)
	if (!issue) return res.status(404).json({ error: "Заявка не найдена" })
	await db
		.prepare(
			`UPDATE room_issues SET status = ?,
			   closed_at = CASE WHEN ? = 'Починено' THEN COALESCE(closed_at, to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')) ELSE NULL END
			 WHERE id = ?`,
		)
		.run(status, status, req.params.id)
	if (status !== issue.status)
		push.notify([issue.user_id, ...(await roomUserIds(issue.room_id))].filter((id) => id !== req.user.id), {
			title: `${{ Починено: "Починили", "В работе": "Взяли в работу" }[status] || "Снова открыта"}: ${issue.amenity_name || "заявка"}`,
			body: `Номер ${issue.room_number} · статус «${status}»`,
			url: "/me/issues",
			tag: "issue-" + req.params.id,
		})
	const mates = await roomUserIds(issue.room_id)
	broadcast("issues:changed", { issueId: Number(req.params.id) }, (user) => STAFF_ROLES.has(user.role) || user.id === issue.user_id || mates.includes(user.id))
	res.json({ ok: true })
})

// Удалить лишнюю заявку (дубль, ошибка) вместе с перепиской
api.delete("/issues/:id", requireRole("editor"), async (req, res) => {
	const issue = await db.prepare("SELECT user_id, room_id FROM room_issues WHERE id = ?").get(req.params.id)
	if (!issue) return res.status(404).json({ error: "Заявка не найдена" })
	await db.prepare("DELETE FROM room_issues WHERE id = ?").run(req.params.id)
	const mates = await roomUserIds(issue.room_id)
	broadcast("issues:changed", { issueId: Number(req.params.id), deleted: true }, (user) => STAFF_ROLES.has(user.role) || user.id === issue.user_id || mates.includes(user.id))
	res.json({ ok: true })
})

// Имя файла по-русски: в заголовке допустим только ASCII, поэтому кириллицу
// передаём через filename* (RFC 5987), а в filename — транслитерацию-заглушку.
async function sendWorkbook(res, wb, name) {
	const buf = await wb.xlsx.writeBuffer()
	const ascii = name.replace(/[^ -~]/g, "_")
	res.setHeader("Content-Disposition", `attachment; filename="${ascii}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`)
	res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	res.send(Buffer.from(buf))
}

async function sendXlsx(res, data, name, header) {
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("Отчёт")
	for (const line of header) ws.addRow(line)
	if (data.length) {
		ws.addRow(Object.keys(data[0]))
		for (const row of data) ws.addRow(Object.values(row))
	}
	const buf = await wb.xlsx.writeBuffer()
	res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`)
	res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	res.send(Buffer.from(buf))
}

const publicDir = path.join(__dirname, "..", "public")
const distDir = path.join(__dirname, "..", "dist")

// Единая точка для сбоев, до которых не добрались проверки в обработчиках.
api.use((err, req, res, _next) => {
	// 23P01 — сработало EXCLUDE-ограничение на пересечение броней. Это не поломка,
	// а гонка двух одновременных бронирований: второму отвечаем как обычному конфликту.
	if (err?.code === "23P01" && err?.constraint === "placements_no_overlap") {
		return res.status(409).json({ error: "Место только что заняли. Обновите календарь и выберите другое." })
	}
	console.error(`${req.method} ${req.originalUrl}:`, err?.stack || err?.message || err)
	res.status(500).json({ error: "Внутренняя ошибка сервера" })
})

app.use("/api", api)

// Любой неизвестный /api-запрос (не только GET) должен отвечать JSON'ом, иначе фронт
// получает HTML и показывает бесполезное «Ошибка запроса». Частый случай — сервер
// запущен из старого кода, а фронтенд уже собран с новыми эндпоинтами.
app.all("/api/*", async (req, res) => {
	res.status(404).json({
		error: `Эндпоинт не найден: ${req.method} ${req.originalUrl.split("?")[0]}. Если фронтенд новее сервера — перезапустите сервер (npm start).`,
	})
})

app.use("/uploads", express.static(uploadsDir))
app.use(express.static(publicDir, { index: false }))
app.get("/legacy", async (_req, res) => res.sendFile(path.join(publicDir, "index.html")))

app.use(express.static(distDir))
app.get("*", async (req, res) => {
	if (req.path.startsWith("/api")) return res.status(404).json({ error: "Не найдено" })
	const index = path.join(distDir, "index.html")
	if (fs.existsSync(index)) return res.sendFile(index)
	res.status(503).send("Фронтенд не собран. Выполните: npm run build")
})

const PORT = process.env.PORT || 3000
// Сервер создаётся сразу (на него подписываются тесты и WebSocket), но слушать порт
// начинает только после того, как схема в PostgreSQL готова — иначе первые запросы
// попадут в ещё не созданные таблицы.
const server = http.createServer(app)
realtime = createRealtimeServer(server)

const ready = db.ready
	.then(() => {
		server.listen(PORT, () => {
			const addr = server.address()
			console.log(`Хиагда запущена: http://localhost:${typeof addr === "object" && addr ? addr.port : PORT}`)
		})
		if (require.main === module) {
			backups.schedule()
			storage.schedule()
		}
	})
	.catch((e) => {
		console.error("Не удалось подготовить базу PostgreSQL:", e.message)
		console.error("Проверьте DATABASE_URL / PG* в .env и доступность сервера СУБД.")
		process.exit(1)
	})

module.exports = { app, server, ready }
