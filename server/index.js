const path = require("node:path")
const fs = require("node:fs")
const express = require("express")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const multer = require("multer")
const ExcelJS = require("exceljs")

const db = require("./db")
const { sign, authenticate, requireRole, requireStaff } = require("./auth")

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
const imagesFor = (ownerType, ownerId) =>
	db.prepare("SELECT id, url FROM images WHERE owner_type = ? AND owner_id = ? ORDER BY sort, id").all(ownerType, ownerId)

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" }
const CYRILLIC_TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" }
const translit = (s) => (s || "").toLowerCase().split("").map((c) => (c in CYRILLIC_TRANSLIT ? CYRILLIC_TRANSLIT[c] : c in TRANSLIT ? TRANSLIT[c] : c)).join("").replace(/[^a-z0-9]/g, "")
function genUsername(resident) {
	let base = resident.tab_number ? translit(resident.tab_number) : ""
	if (!base) {
		const parts = (resident.full_name || "").trim().split(/\s+/)
		base = translit(parts[0] || "user") + (parts[1] ? translit(parts[1]).slice(0, 1) : "")
	}
	base = (base || "user").slice(0, 16)
	let u = base
	let i = 1
	while (db.prepare("SELECT 1 FROM users WHERE username = ?").get(u)) u = base + ++i
	return u
}
function genPassword() {
	const a = "abcdefghjkmnpqrstuvwxyz23456789"
	let p = ""
	for (let i = 0; i < 8; i++) p += a[Math.floor(Math.random() * a.length)]
	return p
}

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage() })

const uploadsDir = path.join(__dirname, "..", "data", "uploads")
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

api.get("/setup-status", (_req, res) => {
	const count = db.prepare("SELECT COUNT(*) c FROM users").get().c
	res.json({ needsSetup: count === 0 })
})

api.post("/register-admin", (req, res) => {
	if (db.prepare("SELECT COUNT(*) c FROM users").get().c > 0) {
		return res.status(403).json({ error: "Администратор уже создан" })
	}
	const { username, password, full_name } = req.body || {}
	if (!username || !password) return res.status(400).json({ error: "Укажите логин и пароль" })
	const info = db
		.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,'admin')")
		.run(username, bcrypt.hashSync(password, 10), full_name || null)
	const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid)
	res.json({ token: sign(user), user: publicUser(user) })
})

api.post("/login", (req, res) => {
	const { username, password } = req.body || {}
	const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username)
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
]
const AUDIT_VERB = { POST: "создание", PUT: "изменение", DELETE: "удаление" }
function auditSummary(req) {
	const entity = (AUDIT_LABELS.find(([re]) => re.test(req.path)) || [, "Запись"])[1];
	if (entity === "Заявка на ремонт" && req.method === "POST") return "Подана заявка на ремонт";
	if (entity === "Размещение") {
		if (req.method === "DELETE" || (req.method === "PUT" && req.body?.stage === "cancelled")) {
			return "Размещение: отмена брони";
		}
	}
	return `${entity}: ${AUDIT_VERB[req.method] || req.method.toLowerCase()}`;
}

api.use((req, res, next) => {
	if (["POST", "PUT", "DELETE"].includes(req.method)) {
		const orig = res.json.bind(res)
		res.json = (body) => {
			if (res.statusCode < 400) {
				try {
					db.prepare("INSERT INTO audit_log (user_id, username, method, path, summary) VALUES (?,?,?,?,?)").run(
						req.user?.id ?? null,
						req.user?.username ?? null,
						req.method,
						req.path,
						auditSummary(req),
					)
				} catch {}
			}
			return orig(body)
		}
	}
	next()
})

api.get("/me", (req, res) => res.json(req.user))

api.post("/me/password", (req, res) => {
	const { current, next } = req.body || {}
	if (!next || next.length < 4) return res.status(400).json({ error: "Новый пароль слишком короткий (мин. 4 символа)" })
	const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)
	if (!user || !bcrypt.compareSync(current || "", user.password_hash)) {
		return res.status(400).json({ error: "Текущий пароль неверный" })
	}
	db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(bcrypt.hashSync(next, 10), req.user.id)
	res.json({ ok: true })
})

function activePlacement(residentId) {
	const today = new Date().toISOString().slice(0, 10)
	return db
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
				abs(julianday(p.date_from) - julianday(?))
			 LIMIT 1`,
		)
		.get(residentId, today, today, today)
}

api.get("/me/overview", (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.json({ resident: null, placement: null, room: null, roommates: [], hotel: null })
	const resident = db.prepare("SELECT id, full_name, tab_number, company, position, phone, about, photo, show_contacts FROM residents WHERE id = ?").get(rid)
	const pl = activePlacement(rid)
	let room = null
	let roommates = []
	let hotel = null
	if (pl) {
		const roomAmenities = db
			.prepare("SELECT a.name, a.icon FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id WHERE ra.room_id = ? ORDER BY a.name")
			.all(pl.room_id)
		room = {
			id: pl.room_id,
			number: pl.room_number,
			floor: pl.floor,
			capacity: pl.capacity,
			class_name: pl.class_name,
			description: pl.room_description,
			amenities: roomAmenities,
			images: imagesFor("room", pl.room_id),
		}
		roommates = db
			.prepare(
				`SELECT DISTINCT r.id, r.full_name, r.company, r.position, r.about, r.photo,
					CASE WHEN r.show_contacts = 1 THEN r.phone ELSE NULL END AS phone,
					b.label AS bed_label, p.date_from, p.date_to
				 FROM placements p
				 JOIN beds b ON b.id = p.bed_id
				 JOIN residents r ON r.id = p.resident_id
				 WHERE b.room_id = ? AND p.stage <> 'cancelled' AND r.id <> ?
					AND p.date_from <= ? AND p.date_to >= ?
				 ORDER BY r.full_name`,
			)
			.all(pl.room_id, rid, pl.date_to, pl.date_from)
		const h = db.prepare("SELECT * FROM hotels WHERE id = ?").get(pl.hotel_id)
		const hotelAmenities = db
			.prepare("SELECT a.name, a.icon FROM hotel_amenities ha JOIN amenities a ON a.id = ha.amenity_id WHERE ha.hotel_id = ? ORDER BY a.name")
			.all(pl.hotel_id)
		const places = db.prepare("SELECT id, name, kind, note, distance, latitude, longitude, icon FROM places WHERE hotel_id = ? ORDER BY name").all(pl.hotel_id)
		const info = db.prepare("SELECT id, kind, title, body, sort FROM hotel_info_sections WHERE hotel_id = ? ORDER BY sort, id").all(pl.hotel_id)
		const rev = db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ?").get(pl.hotel_id)
		hotel = {
			...h,
			amenities: hotelAmenities,
			places,
			info,
			images: imagesFor("hotel", pl.hotel_id),
			rating: rev.avg ? Math.round(rev.avg * 10) / 10 : null,
			reviews_count: rev.c,
		}
	}
	const myReview = pl ? db.prepare("SELECT id, rating, text, reply, reply_at FROM reviews WHERE hotel_id = ? AND resident_id = ?").get(pl.hotel_id, rid) : null
	res.json({ resident, placement: pl || null, room, roommates, hotel, my_review: myReview || null })
})

api.post("/me/review", (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.status(400).json({ error: "Профиль не привязан" })
	const rating = Number(req.body?.rating)
	if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: "Оценка должна быть от 1 до 5" })
	const pl = activePlacement(rid)
	if (!pl) return res.status(400).json({ error: "Нет активного размещения" })
	const text = req.body?.text || null
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM reviews WHERE hotel_id = ? AND resident_id = ?").run(pl.hotel_id, rid)
		db.prepare("INSERT INTO reviews (hotel_id, resident_id, rating, text) VALUES (?,?,?,?)").run(pl.hotel_id, rid, rating, text)
	})
	tx()
	res.json({ ok: true })
})

api.put("/me/profile", (req, res) => {
	const rid = req.user.resident_id
	if (!rid) return res.status(400).json({ error: "Профиль не привязан" })
	const { about, photo, phone, show_contacts } = req.body || {}
	db.prepare("UPDATE residents SET about = ?, photo = ?, phone = ?, show_contacts = ? WHERE id = ?").run(
		about ?? null,
		photo ?? null,
		phone ?? null,
		show_contacts ? 1 : 0,
		rid,
	)
	res.json({ ok: true })
})

api.get("/me/issues/count", (req, res) => {
	try {
		const row = db.prepare("SELECT COUNT(*) as count FROM room_issues WHERE status = 'Новая'").get();
		res.json({ count: row ? row.count : 0 });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

api.post("/me/issues", (req, res) => {
	const { room_id, amenity_name, comment, photo } = req.body || {}
	if (!room_id) return res.status(400).json({ error: "Не указан ID комнаты" })
	if (!comment || !comment.trim()) return res.status(400).json({ error: "Пожалуйста, опишите проблему" })

	try {
		const info = db.prepare(`
			INSERT INTO room_issues (room_id, user_id, amenity_name, comment, photo, status, created_at)
			VALUES (?, ?, ?, ?, ?, 'Новая', datetime('now', 'localtime'))
		`).run(room_id, req.user?.id ?? null, amenity_name, comment.trim(), photo || null)

		res.json({ ok: true, id: info.lastInsertRowid })
	} catch (e) {
		res.status(500).json({ error: e.message })
	}
})


api.post("/upload", uploadImage.single("file"), (req, res) => {
	if (!req.file) return res.status(400).json({ error: "Файл не загружен (только изображения до 5 МБ)" })
	res.json({ url: `/uploads/${req.file.filename}` })
})

const isStaffUser = (u) => u?.role === "admin" || u?.role === "editor"

function announcementsFor(hotelId) {
	return db
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

function myIssues(userId) {
	return db
		.prepare(
			`SELECT ri.id, ri.amenity_name, ri.comment, ri.status, ri.photo, ri.created_at,
				rm.number AS room_number, h.name AS hotel_name,
				(SELECT COUNT(*) FROM issue_comments ic WHERE ic.issue_id = ri.id) AS comments_count
			 FROM room_issues ri
			 JOIN rooms rm ON rm.id = ri.room_id
			 JOIN hotels h ON h.id = rm.hotel_id
			 WHERE ri.user_id = ?
			 ORDER BY ri.id DESC`,
		)
		.all(userId)
}

api.get("/me/announcements", (req, res) => {
	const pl = req.user.resident_id ? activePlacement(req.user.resident_id) : null
	res.json(announcementsFor(pl?.hotel_id))
})

api.post("/me/announcements/seen", (req, res) => {
	db.prepare("UPDATE users SET announcements_seen_at = datetime('now') WHERE id = ?").run(req.user.id)
	res.json({ ok: true })
})

api.get("/me/feed", (req, res) => {
	const rid = req.user.resident_id
	const resident = rid ? db.prepare("SELECT id, full_name FROM residents WHERE id = ?").get(rid) : null
	const pl = rid ? activePlacement(rid) : null
	const announcements = announcementsFor(pl?.hotel_id)
	const seen = db.prepare("SELECT announcements_seen_at FROM users WHERE id = ?").get(req.user.id)?.announcements_seen_at
	const unread = announcements.filter((a) => !seen || a.created_at > seen).length
	res.json({
		resident,
		placement: pl || null,
		announcements,
		unread,
		issues: myIssues(req.user.id),
	})
})

api.get("/me/issues", (req, res) => res.json(myIssues(req.user.id)))

api.get("/issues/:id/comments", (req, res) => {
	const issue = db.prepare("SELECT user_id FROM room_issues WHERE id = ?").get(req.params.id)
	if (!issue) return res.status(404).json({ error: "Заявка не найдена" })
	if (!isStaffUser(req.user) && issue.user_id !== req.user.id) return res.status(403).json({ error: "Недостаточно прав" })
	res.json(
		db
			.prepare(
				`SELECT ic.id, ic.text, ic.created_at, u.full_name AS author, u.role AS author_role
				 FROM issue_comments ic LEFT JOIN users u ON u.id = ic.user_id
				 WHERE ic.issue_id = ? ORDER BY ic.id`,
			)
			.all(req.params.id),
	)
})

api.post("/issues/:id/comments", (req, res) => {
	const issue = db.prepare("SELECT user_id FROM room_issues WHERE id = ?").get(req.params.id)
	if (!issue) return res.status(404).json({ error: "Заявка не найдена" })
	if (!isStaffUser(req.user) && issue.user_id !== req.user.id) return res.status(403).json({ error: "Недостаточно прав" })
	const text = (req.body?.text || "").trim()
	if (!text) return res.status(400).json({ error: "Введите сообщение" })
	const info = db.prepare("INSERT INTO issue_comments (issue_id, user_id, text) VALUES (?,?,?)").run(req.params.id, req.user.id, text)
	res.json({ id: info.lastInsertRowid })
})

api.use(requireStaff)

api.get("/map", (req, res) => {
	const today = new Date().toISOString().slice(0, 10)
	const hotels = db.prepare("SELECT id, name, settlement, address, latitude, longitude FROM hotels ORDER BY name").all()
	const out = hotels.map((h) => {
		const beds = db.prepare("SELECT COUNT(*) c FROM beds b JOIN rooms rm ON rm.id = b.room_id WHERE rm.hotel_id = ?").get(h.id).c
		const occupied = db
			.prepare(
				`SELECT COUNT(DISTINCT p.bed_id) c FROM placements p
				 JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
				 WHERE rm.hotel_id = ? AND p.stage IN ('expected','checked_in') AND p.date_from <= ? AND p.date_to >= ?`,
			)
			.get(h.id, today, today).c
		const arrivals = db
			.prepare(
				`SELECT COUNT(*) c FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
				 WHERE rm.hotel_id = ? AND p.date_from = ? AND p.stage <> 'cancelled'`,
			)
			.get(h.id, today).c
		const repair = db
			.prepare(
				`SELECT COUNT(*) c FROM room_blocks rb JOIN rooms rm ON rm.id = rb.room_id
				 WHERE rm.hotel_id = ? AND rb.date_from <= ? AND rb.date_to >= ?`,
			)
			.get(h.id, today, today).c
		const rev = db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ?").get(h.id)
		return {
			id: h.id,
			name: h.name,
			settlement: h.settlement,
			address: h.address,
			latitude: h.latitude ? Number(h.latitude) : null,
			longitude: h.longitude ? Number(h.longitude) : null,
			beds,
			occupied,
			free: Math.max(0, beds - occupied),
			arrivals,
			repair,
			occupancy: beds ? Math.round((occupied / beds) * 100) : 0,
			rating: rev.avg ? Math.round(rev.avg * 10) / 10 : null,
		}
	})
	res.json(out)
})

api.get("/announcements", (_req, res) =>
	res.json(
		db
			.prepare(
				`SELECT a.*, u.full_name AS author, h.name AS hotel_name
				 FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN hotels h ON h.id = a.hotel_id
				 ORDER BY a.pinned DESC, a.created_at DESC`,
			)
			.all(),
	),
)
api.post("/announcements", requireRole("editor"), (req, res) => {
	const { hotel_id, title, body, pinned } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	const info = db
		.prepare("INSERT INTO announcements (hotel_id, title, body, pinned, created_by) VALUES (?,?,?,?,?)")
		.run(hotel_id || null, title, body, pinned ? 1 : 0, req.user.id)
	res.json({ id: info.lastInsertRowid })
})
api.put("/announcements/:id", requireRole("editor"), (req, res) => {
	const { hotel_id, title, body, pinned } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	db.prepare("UPDATE announcements SET hotel_id=?, title=?, body=?, pinned=? WHERE id=?").run(hotel_id || null, title, body, pinned ? 1 : 0, req.params.id)
	res.json({ ok: true })
})
api.delete("/announcements/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM announcements WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/issues", (req, res) => {
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
		db
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

api.put("/reviews/:id/reply", requireRole("editor"), (req, res) => {
	const reply = (req.body?.reply || "").trim()
	db.prepare("UPDATE reviews SET reply = ?, reply_at = CASE WHEN ? = '' THEN NULL ELSE datetime('now') END WHERE id = ?").run(reply || null, reply, req.params.id)
	res.json({ ok: true })
})

api.get("/hotels/:id/info", (req, res) => res.json(db.prepare("SELECT * FROM hotel_info_sections WHERE hotel_id = ? ORDER BY sort, id").all(req.params.id)))
api.post("/hotels/:id/info", requireRole("editor"), (req, res) => {
	const { kind, title, body, sort } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	const info = db
		.prepare("INSERT INTO hotel_info_sections (hotel_id, kind, title, body, sort) VALUES (?,?,?,?,?)")
		.run(req.params.id, kind || "custom", title, body, Number(sort) || 0)
	res.json({ id: info.lastInsertRowid })
})
api.put("/info/:id", requireRole("editor"), (req, res) => {
	const { kind, title, body, sort } = req.body || {}
	if (!title || !body) return res.status(400).json({ error: "Заголовок и текст обязательны" })
	db.prepare("UPDATE hotel_info_sections SET kind=?, title=?, body=?, sort=? WHERE id=?").run(kind || "custom", title, body, Number(sort) || 0, req.params.id)
	res.json({ ok: true })
})
api.delete("/info/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM hotel_info_sections WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/audit", requireRole("admin"), (req, res) => {
	const limit = Math.min(500, Number(req.query.limit) || 200)
	res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit))
})

api.get("/movements", (req, res) => {
	const date = req.query.date || new Date().toISOString().slice(0, 10)
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
		arrivals: db.prepare(`${base} WHERE p.date_from = ? ORDER BY h.name, rm.number`).all(date),
		departures: db.prepare(`${base} WHERE p.date_to = ? ORDER BY h.name, rm.number`).all(date),
	})
})

api.get("/journal", (req, res) => {
	const filters = []
	const args = []
	if (req.query.hotel_id) {
		filters.push("rm.hotel_id = ?")
		args.push(req.query.hotel_id)
	}
	if (req.query.from && req.query.to) {
		filters.push("p.date_from <= ? AND p.date_to >= ?")
		args.push(req.query.to, req.query.from)
	}
	if (req.query.q) {
		filters.push("(r.full_name LIKE ? OR rm.number LIKE ?)")
		args.push(`%${req.query.q}%`, `%${req.query.q}%`)
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
	res.json(
		db
			.prepare(
				`SELECT p.id, p.date_from, p.date_to, p.comment, p.stage,
					r.full_name AS resident_name,
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

api.get("/summary", (req, res) => {
	const today = new Date().toISOString().slice(0, 10)
	const hotels = db.prepare("SELECT id, name FROM hotels ORDER BY name").all()
	const result = hotels.map((h) => {
		const beds = db
			.prepare(
				"SELECT COUNT(*) c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.hotel_id = ?",
			)
			.get(h.id).c
		const occupied = db
			.prepare(
				`SELECT COUNT(DISTINCT b.id) c
				 FROM beds b JOIN rooms r ON r.id = b.room_id
				 JOIN placements p ON p.bed_id = b.id
				 WHERE r.hotel_id = ? AND p.date_from <= ? AND p.date_to >= ?`,
			)
			.get(h.id, today, today).c
		const rooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE hotel_id = ?").get(h.id).c
		return { ...h, rooms, beds, occupied, free: beds - occupied, load: beds ? Math.round((occupied / beds) * 100) : 0 }
	})
	res.json(result)
})

api.get("/dashboard", (req, res) => {
	const today = new Date().toISOString().slice(0, 10)
	const hotels = db.prepare("SELECT id, name FROM hotels ORDER BY name").all()
	let tRooms = 0
	let tBeds = 0
	let tOcc = 0
	const hotelStats = hotels.map((h) => {
		const beds = db.prepare("SELECT COUNT(*) c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.hotel_id = ?").get(h.id).c
		const occupied = db
			.prepare(
				`SELECT COUNT(DISTINCT b.id) c FROM beds b JOIN rooms r ON r.id = b.room_id
				 JOIN placements p ON p.bed_id = b.id
				 WHERE r.hotel_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to >= ?`,
			)
			.get(h.id, today, today).c
		const rooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE hotel_id = ?").get(h.id).c
		tRooms += rooms
		tBeds += beds
		tOcc += occupied
		return { ...h, rooms, beds, occupied, free: beds - occupied, load: beds ? Math.round((occupied / beds) * 100) : 0 }
	})

	const trendStmt = db.prepare(
		`SELECT COUNT(DISTINCT p.bed_id) c FROM placements p
		 WHERE p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to >= ?`,
	)
	const trend = []
	for (let i = 0; i < 14; i++) {
		const d = new Date(`${today}T00:00:00`)
		d.setDate(d.getDate() + i)
		const day = d.toISOString().slice(0, 10)
		const occ = trendStmt.get(day, day).c
		trend.push({ date: day, occupied: occ, load: tBeds ? Math.round((occ / tBeds) * 100) : 0 })
	}

	const stageRow = db
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
	const countOn = (col) =>
		db.prepare(`SELECT COUNT(*) c FROM placements WHERE ${col} = ? AND stage <> 'cancelled'`).get(today).c
	const moveBase = `
		SELECT p.date_from, p.date_to, r.full_name AS resident_name,
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
			checkins: countOn("date_from"),
			checkouts: countOn("date_to"),
			inhouse: stages.checked_in,
		},
		stages,
		trend,
		hotels: hotelStats,
		arrivals: db.prepare(`${moveBase} WHERE p.date_from = ? AND p.stage <> 'cancelled' ORDER BY h.name, rm.number LIMIT 12`).all(today),
		departures: db.prepare(`${moveBase} WHERE p.date_to = ? AND p.stage <> 'cancelled' ORDER BY h.name, rm.number LIMIT 12`).all(today),
	})
})

api.get("/analytics", (req, res) => {
	const today = new Date().toISOString().slice(0, 10)
	const hotelFilter = req.query.hotel_id ? "AND rm.hotel_id = ?" : ""
	const hArg = req.query.hotel_id ? [req.query.hotel_id] : []

	const bedFilter = req.query.hotel_id ? "WHERE r.hotel_id = ?" : ""
	const tBeds = db.prepare(`SELECT COUNT(*) c FROM beds b JOIN rooms r ON r.id = b.room_id ${bedFilter}`).get(...hArg).c
	const tRooms = db.prepare(`SELECT COUNT(*) c FROM rooms r ${bedFilter}`).get(...hArg).c

	const occStmt = db.prepare(
		`SELECT COUNT(DISTINCT p.bed_id) c FROM placements p
		 JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
		 WHERE p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to >= ? ${hotelFilter}`,
	)
	const occupancy = []
	let bedNights = 0
	for (let i = 0; i < 30; i++) {
		const d = new Date(`${today}T00:00:00`)
		d.setDate(d.getDate() + i)
		const day = d.toISOString().slice(0, 10)
		const occ = occStmt.get(day, day, ...hArg).c
		occupancy.push({ date: day, occupied: occ, load: tBeds ? Math.round((occ / tBeds) * 100) : 0 })
		bedNights += occ
	}
	const occToday = occupancy[0].occupied

	const byHotel = db
		.prepare("SELECT id, name FROM hotels ORDER BY name")
		.all()
		.filter((h) => !req.query.hotel_id || String(h.id) === String(req.query.hotel_id))
		.map((h) => {
			const beds = db.prepare("SELECT COUNT(*) c FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.hotel_id = ?").get(h.id).c
			const occ = db
				.prepare(
					`SELECT COUNT(DISTINCT p.bed_id) c FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
					 WHERE rm.hotel_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to >= ?`,
				)
				.get(h.id, today, today).c
			return { name: h.name, beds, occupied: occ, load: beds ? Math.round((occ / beds) * 100) : 0 }
		})

	const stageRow = db
		.prepare(
			`SELECT
				SUM(CASE WHEN p.stage='expected' THEN 1 ELSE 0 END) expected,
				SUM(CASE WHEN p.stage='checked_in' THEN 1 ELSE 0 END) checked_in,
				SUM(CASE WHEN p.stage='checked_out' THEN 1 ELSE 0 END) checked_out,
				SUM(CASE WHEN p.stage='cancelled' THEN 1 ELSE 0 END) cancelled
			 FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
			 WHERE p.date_to >= ? ${hotelFilter}`,
		)
		.get(today, ...hArg)
	const stages = { expected: stageRow.expected || 0, checked_in: stageRow.checked_in || 0, checked_out: stageRow.checked_out || 0, cancelled: stageRow.cancelled || 0 }

	const byCompany = db
		.prepare(
			`SELECT COALESCE(NULLIF(r.company, ''), 'Без организации') company, COUNT(DISTINCT r.id) count
			 FROM placements p JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN residents r ON r.id = p.resident_id
			 WHERE p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to >= ? ${hotelFilter}
			 GROUP BY company ORDER BY count DESC LIMIT 8`,
		)
		.all(today, today, ...hArg)

	const movesStmt = db.prepare(
		`SELECT
			(SELECT COUNT(*) FROM placements p JOIN beds b ON b.id=p.bed_id JOIN rooms rm ON rm.id=b.room_id WHERE p.stage<>'cancelled' AND p.date_from=? ${hotelFilter}) arrivals,
			(SELECT COUNT(*) FROM placements p JOIN beds b ON b.id=p.bed_id JOIN rooms rm ON rm.id=b.room_id WHERE p.stage<>'cancelled' AND p.date_to=? ${hotelFilter}) departures`,
	)
	const movements = []
	for (let i = 0; i < 14; i++) {
		const d = new Date(`${today}T00:00:00`)
		d.setDate(d.getDate() + i)
		const day = d.toISOString().slice(0, 10)
		const m = movesStmt.get(day, ...hArg, day, ...hArg)
		movements.push({ date: day, arrivals: m.arrivals, departures: m.departures })
	}

	res.json({
		date: today,
		totals: { rooms: tRooms, beds: tBeds, occupied: occToday, free: tBeds - occToday, load: tBeds ? Math.round((occToday / tBeds) * 100) : 0, bedNights },
		occupancy,
		byHotel,
		stages,
		byCompany,
		movements,
	})
})

api.get("/plan", (req, res) => {
	try {
		// Извлекаем переданную дату из параметров запроса фронтенда
		const date = req.query.date || new Date().toISOString().slice(0, 10);

		// 1. Собираем комнаты с подсчетом новых жалоб
		const rooms = db.prepare(`
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
			WHERE p.bed_id = ? AND p.date_from <= ? AND p.date_to >= ? LIMIT 1
		`)
		const blockStmt = db.prepare(`
			SELECT id, reason, date_from, date_to 
			FROM room_blocks 
			WHERE room_id = ? AND date_from <= ? AND date_to >= ? LIMIT 1
		`)

		for (const room of rooms) {
			room.beds = bedStmt.all(room.id).map((b) => ({ ...b, placement: plStmt.get(b.id, date, date) || null }))
			room.occupied = room.beds.filter((b) => b.placement).length
			room.block = blockStmt.get(room.id, date, date) || null
		}

		res.json({ date, rooms })
	} catch (e) {
		res.status(500).json({ error: e.message })
	}
})

const ROLES = ["admin", "editor", "viewer"]
api.get("/users", requireRole("admin"), (_req, res) => {
	res.json(
		db
			.prepare(
				`SELECT u.id, u.username, u.full_name, u.role, u.resident_id, u.created_at, r.full_name AS resident_name
				 FROM users u LEFT JOIN residents r ON r.id = u.resident_id ORDER BY u.username`,
			)
			.all(),
	)
})
api.post("/users", requireRole("admin"), (req, res) => {
	const { username, password, full_name, role } = req.body || {}
	const resident_id = role === "viewer" ? Number(req.body?.resident_id) || null : null
	if (!username || !password || !ROLES.includes(role)) {
		return res.status(400).json({ error: "Заполните логин, пароль и роль" })
	}
	if (role === "viewer" && !resident_id) {
		return res.status(400).json({ error: "Для роли «Просмотр» выберите проживающего" })
	}
	try {
		const info = db
			.prepare("INSERT INTO users (username, password_hash, full_name, role, resident_id) VALUES (?,?,?,?,?)")
			.run(username, bcrypt.hashSync(password, 10), full_name || null, role, resident_id)
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такой логин уже существует" })
	}
})
const countAdmins = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c

api.put("/users/:id", requireRole("admin"), (req, res) => {
	const id = Number(req.params.id)
	const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id)
	if (!target) return res.status(404).json({ error: "Пользователь не найден" })
	const { full_name, role, password } = req.body || {}
	if (role && !ROLES.includes(role)) {
		return res.status(400).json({ error: "Некорректная роль" })
	}
	if (role && role !== "admin" && target.role === "admin" && countAdmins() <= 1) {
		return res.status(400).json({ error: "Нельзя снять права у последнего администратора" })
	}
	const nextRole = role || target.role
	const resident_id =
		nextRole === "viewer" ? (req.body?.resident_id !== undefined ? Number(req.body.resident_id) || null : target.resident_id) : null
	if (nextRole === "viewer" && !resident_id) {
		return res.status(400).json({ error: "Для роли «Просмотр» выберите проживающего" })
	}
	db.prepare("UPDATE users SET full_name = ?, role = ?, resident_id = ? WHERE id = ?").run(
		full_name ?? target.full_name,
		nextRole,
		resident_id,
		id,
	)
	if (password) {
		db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), id)
	}
	res.json({ ok: true })
})

api.delete("/users/:id", requireRole("admin"), (req, res) => {
	const id = Number(req.params.id)
	if (id === req.user.id) return res.status(400).json({ error: "Нельзя удалить собственную учётную запись" })
	const target = db.prepare("SELECT role FROM users WHERE id = ?").get(id)
	if (target?.role === "admin" && countAdmins() <= 1) {
		return res.status(400).json({ error: "Нельзя удалить последнего администратора" })
	}
	db.prepare("DELETE FROM users WHERE id = ?").run(id)
	res.json({ ok: true })
})

function issueAccount(resident) {
	const existing = db.prepare("SELECT id, username FROM users WHERE resident_id = ?").get(resident.id)
	const password = genPassword()
	const hash = bcrypt.hashSync(password, 10)
	if (existing) {
		db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hash, existing.id)
		return { username: existing.username, password, reset: true }
	}
	const username = genUsername(resident)
	db.prepare("INSERT INTO users (username, password_hash, full_name, role, resident_id, must_change_password) VALUES (?,?,?,'viewer',?,1)").run(
		username,
		hash,
		resident.full_name,
		resident.id,
	)
	return { username, password, reset: false }
}

api.post("/residents/:id/account", requireRole("admin"), (req, res) => {
	const resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!resident) return res.status(404).json({ error: "Проживающий не найден" })
	const cred = issueAccount(resident)
	res.json({ full_name: resident.full_name, ...cred })
})

api.delete("/residents/:id/account", requireRole("admin"), (req, res) => {
	db.prepare("DELETE FROM users WHERE resident_id = ? AND role = 'viewer'").run(req.params.id)
	res.json({ ok: true })
})

api.post("/residents/accounts/bulk", requireRole("admin"), (req, res) => {
	const without = db
		.prepare(
			`SELECT r.* FROM residents r
			 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.resident_id = r.id)
			 ORDER BY r.full_name`,
		)
		.all()
	const issued = []
	const tx = db.transaction(() => {
		for (const r of without) issued.push({ full_name: r.full_name, ...issueAccount(r) })
	})
	tx()
	res.json({ issued })
})

const HOTEL_FIELDS = ["name", "location", "settlement", "address", "phone", "email", "check_in", "check_out", "latitude", "longitude", "description", "rules"]
api.get("/hotels", (_req, res) => res.json(db.prepare("SELECT * FROM hotels ORDER BY name").all()))
api.get("/hotels/:id", (req, res) => {
	const hotel = db.prepare("SELECT * FROM hotels WHERE id = ?").get(req.params.id)
	if (!hotel) return res.status(404).json({ error: "Гостиница не найдена" })
	hotel.amenities = db
		.prepare("SELECT a.* FROM hotel_amenities ha JOIN amenities a ON a.id = ha.amenity_id WHERE ha.hotel_id = ? ORDER BY a.name")
		.all(hotel.id)
	hotel.places = db.prepare("SELECT * FROM places WHERE hotel_id = ? ORDER BY name").all(hotel.id)
	hotel.info = db.prepare("SELECT * FROM hotel_info_sections WHERE hotel_id = ? ORDER BY sort, id").all(hotel.id)
	hotel.images = imagesFor("hotel", hotel.id)
	const rev = db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ?").get(hotel.id)
	hotel.reviews_count = rev.c
	hotel.rating = rev.avg ? Math.round(rev.avg * 10) / 10 : null
	res.json(hotel)
})
api.post("/hotels", requireRole("editor"), (req, res) => {
	const b = req.body || {}
	if (!b.name) return res.status(400).json({ error: "Укажите название" })
	const cols = HOTEL_FIELDS.join(", ")
	const ph = HOTEL_FIELDS.map(() => "?").join(", ")
	const info = db
		.prepare(`INSERT INTO hotels (${cols}) VALUES (${ph})`)
		.run(...HOTEL_FIELDS.map((f) => b[f] || null))
	res.json({ id: info.lastInsertRowid })
})
api.put("/hotels/:id", requireRole("editor"), (req, res) => {
	const b = req.body || {}
	const set = HOTEL_FIELDS.map((f) => `${f}=?`).join(", ")
	db.prepare(`UPDATE hotels SET ${set} WHERE id=?`).run(...HOTEL_FIELDS.map((f) => b[f] || null), req.params.id)
	res.json({ ok: true })
})
api.delete("/hotels/:id", requireRole("admin"), (req, res) => {
	const id = Number(req.params.id)
	db.prepare("DELETE FROM images WHERE owner_type = 'hotel' AND owner_id = ?").run(id)
	db.prepare("DELETE FROM images WHERE owner_type = 'room' AND owner_id IN (SELECT id FROM rooms WHERE hotel_id = ?)").run(id)
	db.prepare("DELETE FROM hotels WHERE id = ?").run(id)
	res.json({ ok: true })
})

api.get("/hotels/:id/places", (req, res) =>
	res.json(db.prepare("SELECT * FROM places WHERE hotel_id = ? ORDER BY name").all(req.params.id)),
)
api.post("/hotels/:id/places", requireRole("editor"), (req, res) => {
	const { name, kind, note, distance, latitude, longitude, icon } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название места" })
	const info = db
		.prepare("INSERT INTO places (hotel_id, name, kind, note, distance, latitude, longitude, icon) VALUES (?,?,?,?,?,?,?,?)")
		.run(req.params.id, name, kind || null, note || null, distance || null, latitude || null, longitude || null, icon || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/places/:id", requireRole("editor"), (req, res) => {
	const { name, kind, note, distance, latitude, longitude, icon } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название места" })
	db.prepare("UPDATE places SET name=?, kind=?, note=?, distance=?, latitude=?, longitude=?, icon=? WHERE id=?").run(
		name, kind || null, note || null, distance || null, latitude || null, longitude || null, icon || null, req.params.id,
	)
	res.json({ ok: true })
})
api.delete("/places/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM places WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/amenities", (_req, res) => res.json(db.prepare("SELECT * FROM amenities ORDER BY name").all()))
api.post("/amenities", requireRole("editor"), (req, res) => {
	const { name, icon, scope } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название удобства" })
	try {
		const info = db
			.prepare("INSERT INTO amenities (name, icon, scope) VALUES (?,?,?)")
			.run(name, icon || "dot", ["room", "hotel", "both"].includes(scope) ? scope : "both")
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такое удобство уже есть" })
	}
})
api.delete("/amenities/:id", requireRole("admin"), (req, res) => {
	db.prepare("DELETE FROM amenities WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})
api.put("/hotels/:id/amenities", requireRole("editor"), (req, res) => {
	const ids = Array.isArray(req.body?.amenity_ids) ? req.body.amenity_ids.map(Number).filter(Boolean) : []
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM hotel_amenities WHERE hotel_id = ?").run(req.params.id)
		const ins = db.prepare("INSERT OR IGNORE INTO hotel_amenities (hotel_id, amenity_id) VALUES (?,?)")
		for (const aid of ids) ins.run(req.params.id, aid)
	})
	tx()
	res.json({ ok: true })
})
api.put("/rooms/:id/amenities", requireRole("editor"), (req, res) => {
	const ids = Array.isArray(req.body?.amenity_ids) ? req.body.amenity_ids.map(Number).filter(Boolean) : []
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM room_amenities WHERE room_id = ?").run(req.params.id)
		const ins = db.prepare("INSERT OR IGNORE INTO room_amenities (room_id, amenity_id) VALUES (?,?)")
		for (const aid of ids) ins.run(req.params.id, aid)
	})
	tx()
	res.json({ ok: true })
})

function addImage(ownerType, ownerId, url, res) {
	if (!url || !/^(https?:\/\/|\/uploads\/)/i.test(url)) return res.status(400).json({ error: "Укажите ссылку на изображение (http/https)" })
	const sort = db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 s FROM images WHERE owner_type = ? AND owner_id = ?").get(ownerType, ownerId).s
	const info = db.prepare("INSERT INTO images (owner_type, owner_id, url, sort) VALUES (?,?,?,?)").run(ownerType, ownerId, url, sort)
	res.json({ id: info.lastInsertRowid })
}
api.post("/hotels/:id/images", requireRole("editor"), (req, res) => addImage("hotel", Number(req.params.id), req.body?.url, res))
api.post("/rooms/:id/images", requireRole("editor"), (req, res) => addImage("room", Number(req.params.id), req.body?.url, res))
api.delete("/images/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM images WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/hotels/:id/reviews", (req, res) => {
	const rev = db.prepare("SELECT COUNT(*) c, AVG(rating) avg FROM reviews WHERE hotel_id = ?").get(req.params.id)
	const list = db
		.prepare(
			`SELECT rv.id, rv.rating, rv.text, rv.created_at, rv.reply, rv.reply_at, r.full_name AS resident_name
			 FROM reviews rv LEFT JOIN residents r ON r.id = rv.resident_id
			 WHERE rv.hotel_id = ? ORDER BY rv.created_at DESC LIMIT 50`,
		)
		.all(req.params.id)
	res.json({ count: rev.c, average: rev.avg ? Math.round(rev.avg * 10) / 10 : null, reviews: list })
})
api.delete("/reviews/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM reviews WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/classes", (_req, res) => res.json(db.prepare("SELECT * FROM room_classes ORDER BY name").all()))
api.post("/classes", requireRole("editor"), (req, res) => {
	try {
		const info = db.prepare("INSERT INTO room_classes (name) VALUES (?)").run(req.body.name)
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такой класс уже есть" })
	}
})
api.delete("/classes/:id", requireRole("admin"), (req, res) => {
	db.prepare("DELETE FROM room_classes WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/statuses", (_req, res) => res.json(db.prepare("SELECT * FROM statuses ORDER BY sort, id").all()))
api.post("/statuses", requireRole("editor"), (req, res) => {
	const { name, color, sort } = req.body || {}
	if (!name || !color) return res.status(400).json({ error: "Укажите название и цвет" })
	try {
		const info = db.prepare("INSERT INTO statuses (name, color, sort) VALUES (?,?,?)").run(name, color, sort || 0)
		res.json({ id: info.lastInsertRowid })
	} catch {
		res.status(400).json({ error: "Такой статус уже есть" })
	}
})
api.put("/statuses/:id", requireRole("editor"), (req, res) => {
	const { name, color, sort } = req.body || {}
	db.prepare("UPDATE statuses SET name = ?, color = ?, sort = ? WHERE id = ?").run(name, color, sort || 0, req.params.id)
	res.json({ ok: true })
})
api.delete("/statuses/:id", requireRole("admin"), (req, res) => {
	try {
		db.prepare("DELETE FROM statuses WHERE id = ?").run(req.params.id)
		res.json({ ok: true })
	} catch {
		res.status(400).json({ error: "Статус используется в размещениях" })
	}
})

api.get("/rooms", (req, res) => {
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
	const rooms = db
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
		room.beds = bedsStmt.all(room.id)
		room.amenity_ids = amenStmt.all(room.id).map((r) => r.amenity_id)
		room.images = imagesFor("room", room.id)
	}
	res.json(rooms)
})

api.post("/rooms", requireRole("editor"), (req, res) => {
	const { hotel_id, class_id, number, floor, capacity, description } = req.body || {}
	if (!hotel_id || !number) return res.status(400).json({ error: "Гостиница и номер обязательны" })
	const cap = Math.max(1, parseInt(capacity, 10) || 1)
	const tx = db.transaction(() => {
		const info = db
			.prepare("INSERT INTO rooms (hotel_id, class_id, number, floor, capacity, description) VALUES (?,?,?,?,?,?)")
			.run(hotel_id, class_id || null, number, floor || null, cap, description || null)
		const bed = db.prepare("INSERT INTO beds (room_id, label) VALUES (?,?)")
		for (let i = 1; i <= cap; i++) bed.run(info.lastInsertRowid, `Место ${i}`)
		return info.lastInsertRowid
	})
	res.json({ id: tx() })
})

api.put("/rooms/:id", requireRole("editor"), (req, res) => {
	const { class_id, number, floor, capacity, description } = req.body || {}
	const cap = Math.max(1, parseInt(capacity, 10) || 1)
	const tx = db.transaction(() => {
		db.prepare("UPDATE rooms SET class_id=?, number=?, floor=?, capacity=?, description=? WHERE id=?").run(
			class_id || null,
			number,
			floor || null,
			cap,
			description || null,
			req.params.id,
		)
		const beds = db.prepare("SELECT * FROM beds WHERE room_id = ? ORDER BY id").all(req.params.id)
		if (beds.length < cap) {
			const ins = db.prepare("INSERT INTO beds (room_id, label) VALUES (?,?)")
			for (let i = beds.length + 1; i <= cap; i++) ins.run(req.params.id, `Место ${i}`)
		}
	})
	tx()
	res.json({ ok: true })
})

api.delete("/rooms/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM images WHERE owner_type = 'room' AND owner_id = ?").run(Number(req.params.id))
	db.prepare("DELETE FROM rooms WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/availability", (req, res) => {
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
	const rows = db
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
				SELECT 1 FROM room_blocks rb WHERE rb.room_id = rm.id AND rb.date_from <= ? AND rb.date_to >= ?
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

api.get("/rooms/:id/blocks", (req, res) =>
	res.json(db.prepare("SELECT * FROM room_blocks WHERE room_id = ? ORDER BY date_from DESC").all(req.params.id)),
)
api.post("/rooms/:id/blocks", requireRole("editor"), (req, res) => {
	const { date_from, date_to, reason } = req.body || {}
	if (!date_from || !date_to) return res.status(400).json({ error: "Укажите период ремонта" })
	if (date_to < date_from) return res.status(400).json({ error: "Дата окончания раньше начала" })
	const info = db
		.prepare("INSERT INTO room_blocks (room_id, date_from, date_to, reason) VALUES (?,?,?,?)")
		.run(req.params.id, date_from, date_to, reason || null)
	res.json({ id: info.lastInsertRowid })
})
api.delete("/blocks/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM room_blocks WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/residents", (req, res) => {
	const q = `%${req.query.q || ""}%`
	res.json(
		db
			.prepare(
				`SELECT r.*, u.username AS account_username, u.must_change_password AS account_must_change
				 FROM residents r LEFT JOIN users u ON u.resident_id = r.id AND u.role = 'viewer'
				 WHERE r.full_name LIKE ? OR r.tab_number LIKE ? ORDER BY r.full_name`,
			)
			.all(q, q),
	)
})
api.get("/residents/:id/card", (req, res) => {
	const resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!resident) return res.status(404).json({ error: "Проживающий не найден" })
	const stays = db
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

api.post("/residents", requireRole("editor"), (req, res) => {
	const { full_name, tab_number, company, position, phone, note } = req.body || {}
	if (!full_name) return res.status(400).json({ error: "Укажите ФИО" })
	const info = db
		.prepare("INSERT INTO residents (full_name, tab_number, company, position, phone, note) VALUES (?,?,?,?,?,?)")
		.run(full_name, tab_number || null, company || null, position || null, phone || null, note || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/residents/:id", requireRole("editor"), (req, res) => {
	const { full_name, tab_number, company, position, phone, note } = req.body || {}
	const current = db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Проживающий не найден" })
	const nextName = full_name !== undefined ? String(full_name).trim() : current.full_name
	if (!nextName) return res.status(400).json({ error: "Укажите ФИО" })
	db.prepare(
		"UPDATE residents SET full_name=?, tab_number=?, company=?, position=?, phone=?, note=? WHERE id=?",
	).run(
		nextName,
		tab_number !== undefined ? tab_number || null : current.tab_number,
		company !== undefined ? company || null : current.company,
		position !== undefined ? position || null : current.position,
		phone !== undefined ? phone || null : current.phone,
		note !== undefined ? note || null : current.note,
		req.params.id,
	)
	db.prepare("UPDATE users SET full_name = ? WHERE resident_id = ? AND role = 'viewer'").run(nextName, req.params.id)
	res.json({ ok: true })
})
api.delete("/residents/:id", requireRole("editor"), (req, res) => {
	const removeResident = db.transaction((id) => {
		db.prepare("DELETE FROM users WHERE resident_id = ? AND role = 'viewer'").run(id)
		db.prepare("DELETE FROM reviews WHERE resident_id = ?").run(id)
		db.prepare("DELETE FROM placements WHERE resident_id = ?").run(id)
		db.prepare("DELETE FROM residents WHERE id = ?").run(id)
	})
	removeResident(req.params.id)
	res.json({ ok: true })
})

const placementSelect = `
	SELECT p.*, r.full_name AS resident_name, s.name AS status_name, s.color AS status_color
	FROM placements p
	LEFT JOIN residents r ON r.id = p.resident_id
	JOIN statuses s ON s.id = p.status_id`

api.get("/placements", (req, res) => {
	const args = []
	const filters = []
	if (req.query.from && req.query.to) {
		filters.push("p.date_from <= ? AND p.date_to >= ?")
		args.push(req.query.to, req.query.from)
	}
	if (req.query.bed_id) {
		filters.push("p.bed_id = ?")
		args.push(req.query.bed_id)
	}
	const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
	res.json(db.prepare(`${placementSelect} ${where} ORDER BY p.date_from`).all(...args))
})

api.get("/rack", (req, res) => {
	const { hotel_id, from, to } = req.query
	if (!hotel_id || !from || !to) return res.status(400).json({ error: "Укажите гостиницу и период" })
	const rooms = db
		.prepare(
			`SELECT r.id, r.number, r.floor, c.name AS class_name
			 FROM rooms r LEFT JOIN room_classes c ON c.id = r.class_id
			 WHERE r.hotel_id = ? ORDER BY r.floor, r.number`,
		)
		.all(hotel_id)
	const bedsStmt = db.prepare("SELECT id, label FROM beds WHERE room_id = ? ORDER BY id")
	for (const room of rooms) room.beds = bedsStmt.all(room.id)
	const placements = db
		.prepare(
			`${placementSelect}
			 JOIN beds b ON b.id = p.bed_id JOIN rooms rm ON rm.id = b.room_id
			 WHERE rm.hotel_id = ? AND p.stage <> 'cancelled' AND p.date_from <= ? AND p.date_to > ?
			 ORDER BY p.date_from`,
		)
		.all(hotel_id, to, from)
	const blocks = db
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
function findConflict(bedId, from, to, excludeId) {
	return db
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

// Ремонт [X,Y] делает номер недоступным по ночь Y включительно.
function findBlock(bedId, from, to) {
	return db
		.prepare(
			`SELECT rb.date_from, rb.date_to, rb.reason
			 FROM room_blocks rb
			 JOIN beds b ON b.room_id = rb.room_id
			 WHERE b.id = ? AND rb.date_from <= ? AND rb.date_to >= ?
			 LIMIT 1`,
		)
		.get(bedId, to, from)
}

api.post("/placements", requireRole("editor"), (req, res) => {
	const { bed_id, resident_id, status_id, date_from, date_to, comment } = req.body || {}
	const stage = req.body?.stage || "expected"
	if (stage !== "cancelled" && !resident_id) return res.status(400).json({ error: "Выберите или создайте профиль вахтовика" })
	if (resident_id && !db.prepare("SELECT id FROM residents WHERE id = ?").get(resident_id)) {
		return res.status(400).json({ error: "Профиль вахтовика не найден" })
	}
	if (!bed_id || !status_id || !date_from || !date_to) {
		return res.status(400).json({ error: "Заполните место, статус и даты" })
	}
	if (!STAGES.includes(stage)) return res.status(400).json({ error: "Неизвестная стадия брони" })
	if (date_to < date_from) return res.status(400).json({ error: "Дата выезда раньше даты заезда" })
	const conflict = findConflict(bed_id, date_from, date_to)
	if (conflict) {
		return res.status(409).json({
			error: `Место занято: ${conflict.who} (${conflict.date_from} – ${conflict.date_to})`,
		})
	}
	const block = findBlock(bed_id, date_from, date_to)
	if (block) {
		return res.status(409).json({ error: `Номер на ремонте: ${block.date_from} – ${block.date_to}${block.reason ? ` · ${block.reason}` : ""}` })
	}
	const info = db
		.prepare("INSERT INTO placements (bed_id, resident_id, status_id, stage, date_from, date_to, comment) VALUES (?,?,?,?,?,?,?)")
		.run(bed_id, resident_id || null, status_id, stage, date_from, date_to, comment || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/placements/:id", requireRole("editor"), (req, res) => {
	const { resident_id, status_id, date_from, date_to, comment } = req.body || {}
	if (!status_id || !date_from || !date_to) return res.status(400).json({ error: "Заполните статус и даты" })
	if (date_to < date_from) return res.status(400).json({ error: "Дата выезда раньше даты заезда" })
	const current = db.prepare("SELECT bed_id, stage FROM placements WHERE id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Размещение не найдено" })
	const stage = req.body?.stage || current.stage
	if (stage !== "cancelled" && !resident_id) return res.status(400).json({ error: "Выберите или создайте профиль вахтовика" })
	if (resident_id && !db.prepare("SELECT id FROM residents WHERE id = ?").get(resident_id)) {
		return res.status(400).json({ error: "Профиль вахтовика не найден" })
	}
	if (!STAGES.includes(stage)) return res.status(400).json({ error: "Неизвестная стадия брони" })
	if (!canTransition(current.stage, stage)) {
		return res.status(409).json({ error: "Недопустимый переход стадии брони" })
	}
	const conflict = findConflict(current.bed_id, date_from, date_to, req.params.id)
	if (conflict) {
		return res.status(409).json({
			error: `Место занято: ${conflict.who} (${conflict.date_from} – ${conflict.date_to})`,
		})
	}
	if (stage !== "cancelled") {
		const block = findBlock(current.bed_id, date_from, date_to)
		if (block) return res.status(409).json({ error: `Номер на ремонте: ${block.date_from} – ${block.date_to}${block.reason ? ` · ${block.reason}` : ""}` })
	}
	db.prepare("UPDATE placements SET resident_id=?, status_id=?, stage=?, date_from=?, date_to=?, comment=? WHERE id=?").run(
		resident_id || null,
		status_id,
		stage,
		date_from,
		date_to,
		comment || null,
		req.params.id,
	)
	res.json({ ok: true })
})
api.post("/placements/:id/stage", requireRole("editor"), (req, res) => {
	const stage = req.body?.stage
	if (!STAGES.includes(stage)) return res.status(400).json({ error: "Неизвестная стадия брони" })
	const current = db.prepare("SELECT stage FROM placements WHERE id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Размещение не найдено" })
	if (!canTransition(current.stage, stage)) {
		return res.status(409).json({ error: "Недопустимый переход стадии брони" })
	}
	db.prepare("UPDATE placements SET stage = ? WHERE id = ?").run(stage, req.params.id)
	res.json({ ok: true })
})
api.delete("/placements/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM placements WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/report/room/:id", async (req, res) => {
	const room = db
		.prepare(
			`SELECT r.*, h.name AS hotel_name, c.name AS class_name FROM rooms r
			 JOIN hotels h ON h.id = r.hotel_id LEFT JOIN room_classes c ON c.id = r.class_id WHERE r.id = ?`,
		)
		.get(req.params.id)
	if (!room) return res.status(404).json({ error: "Номер не найден" })
	const rows = db
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
	const person = db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!person) return res.status(404).json({ error: "Проживающий не найден" })
	const rows = db
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

api.post("/import/residents", requireRole("editor"), upload.single("file"), async (req, res) => {
	if (!req.file) return res.status(400).json({ error: "Файл не получен" })
	const wb = new ExcelJS.Workbook()
	try {
		await wb.xlsx.load(req.file.buffer)
	} catch {
		return res.status(400).json({ error: "Не удалось прочитать файл Excel" })
	}
	const ws = wb.worksheets[0]
	if (!ws) return res.status(400).json({ error: "В файле нет листов" })

	const cellText = (cell) => {
		const v = cell?.value
		if (v == null) return ""
		if (typeof v === "object") return String(v.text ?? v.result ?? v.richText?.map((p) => p.text).join("") ?? "").trim()
		return String(v).trim()
	}
	const headers = []
	ws.getRow(1).eachCell((cell, col) => {
		headers[col] = cellText(cell).toLowerCase()
	})
	const colFor = (keys) => headers.findIndex((h) => h && keys.some((n) => h.includes(n)))
	const cols = {
		name: colFor(["фио", "имя", "name"]),
		tab: colFor(["таб", "tab"]),
		company: colFor(["орган", "компан", "company"]),
		position: colFor(["должн", "position"]),
		phone: colFor(["тел", "phone"]),
		note: colFor(["примеч", "note", "коммент"]),
	}
	const get = (row, idx) => (idx > 0 ? cellText(row.getCell(idx)) : "")

	const ins = db.prepare(
		"INSERT INTO residents (full_name, tab_number, company, position, phone, note) VALUES (?,?,?,?,?,?)",
	)
	let count = 0
	const rows = []
	ws.eachRow((row, n) => {
		if (n > 1) rows.push(row)
	})
	const tx = db.transaction(() => {
		for (const row of rows) {
			const name = get(row, cols.name)
			if (!name) continue
			ins.run(
				name,
				get(row, cols.tab) || null,
				get(row, cols.company) || null,
				get(row, cols.position) || null,
				get(row, cols.phone) || null,
				get(row, cols.note) || null,
			)
			count++
		}
	})
	tx()
	res.json({ imported: count })
})

api.get("/rooms/:id/issues", (req, res) => {
	try {
		const issues = db.prepare(`
			SELECT ri.*, u.full_name as user_name 
			FROM room_issues ri
			LEFT JOIN users u ON u.id = ri.user_id
			WHERE ri.room_id = ?
			ORDER BY ri.id DESC
		`).all(req.params.id);
		res.json(issues);
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

api.put("/issues/:id/status", (req, res) => {
	const { status } = req.body || {};
	if (!status) return res.status(400).json({ error: "Укажите status" });
	try {
		db.prepare("UPDATE room_issues SET status = ? WHERE id = ?").run(status, req.params.id);
		res.json({ ok: true });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

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

app.use("/api", api)

app.use("/uploads", express.static(uploadsDir))
app.use(express.static(publicDir, { index: false }))
app.get("/legacy", (_req, res) => res.sendFile(path.join(publicDir, "index.html")))

app.use(express.static(distDir))
app.get("*", (req, res) => {
	if (req.path.startsWith("/api")) return res.status(404).json({ error: "Не найдено" })
	const index = path.join(distDir, "index.html")
	if (fs.existsSync(index)) return res.sendFile(index)
	res.status(503).send("Фронтенд не собран. Выполните: npm run build")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`NochOtel запущен: http://localhost:${PORT}`))
