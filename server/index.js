const path = require("node:path")
const express = require("express")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const multer = require("multer")
const ExcelJS = require("exceljs")

const db = require("./db")
const { sign, authenticate, requireRole } = require("./auth")

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage() })
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
	res.json({
		token: sign(user),
		user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
	})
})

api.post("/login", (req, res) => {
	const { username, password } = req.body || {}
	const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username)
	if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
		return res.status(401).json({ error: "Неверный логин или пароль" })
	}
	res.json({
		token: sign(user),
		user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
	})
})

api.get("/kiosk/lookup", (req, res) => {
	const q = (req.query.q || "").trim()
	if (q.length < 2) return res.json([])
	const today = new Date().toISOString().slice(0, 10)
	const people = db
		.prepare("SELECT id, full_name, company, tab_number FROM residents WHERE full_name LIKE ? OR tab_number LIKE ? ORDER BY full_name LIMIT 8")
		.all(`%${q}%`, `%${q}%`)
	const plStmt = db.prepare(
		`SELECT rm.id AS room_id, rm.number AS room_number, rm.floor, rm.hotel_id,
			h.name AS hotel_name, b.label AS bed_label,
			p.date_from, p.date_to, s.name AS status_name, s.color AS status_color
		 FROM placements p
		 JOIN beds b ON b.id = p.bed_id
		 JOIN rooms rm ON rm.id = b.room_id
		 JOIN hotels h ON h.id = rm.hotel_id
		 JOIN statuses s ON s.id = p.status_id
		 WHERE p.resident_id = ? AND p.date_from <= ? AND p.date_to >= ?
		 ORDER BY p.date_from LIMIT 1`,
	)
	const floorStmt = db.prepare("SELECT number FROM rooms WHERE hotel_id = ? AND IFNULL(floor,-999) = IFNULL(?,-999) ORDER BY number")
	const result = people.map((person) => {
		const placement = plStmt.get(person.id, today, today)
		let floorRooms = []
		if (placement) floorRooms = floorStmt.all(placement.hotel_id, placement.floor).map((r) => r.number)
		return { id: person.id, full_name: person.full_name, company: person.company, placement: placement || null, floorRooms }
	})
	res.json(result)
})

api.use(authenticate)

const AUDIT_LABELS = [
	[/^\/placements/, "Размещение"],
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
	const entity = (AUDIT_LABELS.find(([re]) => re.test(req.path)) || [, "Запись"])[1]
	return `${entity}: ${AUDIT_VERB[req.method] || req.method.toLowerCase()}`
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

api.get("/audit", requireRole("admin"), (req, res) => {
	const limit = Math.min(500, Number(req.query.limit) || 200)
	res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit))
})

api.get("/movements", (req, res) => {
	const date = req.query.date || new Date().toISOString().slice(0, 10)
	const base = `
		SELECT p.id, p.date_from, p.date_to, p.comment,
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
				`SELECT p.id, p.date_from, p.date_to, p.comment,
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
				 JOIN placements p ON p.bed_id = b.id WHERE r.hotel_id = ? AND p.date_from <= ? AND p.date_to >= ?`,
			)
			.get(h.id, today, today).c
		const rooms = db.prepare("SELECT COUNT(*) c FROM rooms WHERE hotel_id = ?").get(h.id).c
		tRooms += rooms
		tBeds += beds
		tOcc += occupied
		return { ...h, rooms, beds, occupied, free: beds - occupied, load: beds ? Math.round((occupied / beds) * 100) : 0 }
	})
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
		},
		hotels: hotelStats,
		arrivals: db.prepare(`${moveBase} WHERE p.date_from = ? ORDER BY h.name, rm.number LIMIT 12`).all(today),
		departures: db.prepare(`${moveBase} WHERE p.date_to = ? ORDER BY h.name, rm.number LIMIT 12`).all(today),
	})
})

api.get("/plan", (req, res) => {
	if (!req.query.hotel_id) return res.json({ date: null, rooms: [] })
	const date = req.query.date || new Date().toISOString().slice(0, 10)
	const rooms = db
		.prepare(
			`SELECT r.*, c.name AS class_name FROM rooms r
			 LEFT JOIN room_classes c ON c.id = r.class_id
			 WHERE r.hotel_id = ? ORDER BY r.floor, r.number`,
		)
		.all(req.query.hotel_id)
	const bedStmt = db.prepare("SELECT * FROM beds WHERE room_id = ? ORDER BY id")
	const plStmt = db.prepare(
		`SELECT p.id, p.resident_id, p.date_from, p.date_to, p.comment,
			r.full_name AS resident_name, s.name AS status_name, s.color AS status_color
		 FROM placements p
		 JOIN statuses s ON s.id = p.status_id
		 LEFT JOIN residents r ON r.id = p.resident_id
		 WHERE p.bed_id = ? AND p.date_from <= ? AND p.date_to >= ? LIMIT 1`,
	)
	for (const room of rooms) {
		room.beds = bedStmt.all(room.id).map((b) => ({ ...b, placement: plStmt.get(b.id, date, date) || null }))
		room.occupied = room.beds.filter((b) => b.placement).length
	}
	res.json({ date, rooms })
})

api.get("/users", requireRole("admin"), (_req, res) => {
	res.json(db.prepare("SELECT id, username, full_name, role, created_at FROM users ORDER BY username").all())
})
api.post("/users", requireRole("admin"), (req, res) => {
	const { username, password, full_name, role } = req.body || {}
	if (!username || !password || !["admin", "editor", "viewer"].includes(role)) {
		return res.status(400).json({ error: "Заполните логин, пароль и роль" })
	}
	try {
		const info = db
			.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)")
			.run(username, bcrypt.hashSync(password, 10), full_name || null, role)
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
	if (role && !["admin", "editor", "viewer"].includes(role)) {
		return res.status(400).json({ error: "Некорректная роль" })
	}
	if (role && role !== "admin" && target.role === "admin" && countAdmins() <= 1) {
		return res.status(400).json({ error: "Нельзя снять права у последнего администратора" })
	}
	db.prepare("UPDATE users SET full_name = ?, role = ? WHERE id = ?").run(
		full_name ?? target.full_name,
		role || target.role,
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

api.post("/me/password", (req, res) => {
	const { current, next } = req.body || {}
	if (!next || next.length < 4) return res.status(400).json({ error: "Новый пароль слишком короткий (мин. 4 символа)" })
	const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)
	if (!user || !bcrypt.compareSync(current || "", user.password_hash)) {
		return res.status(400).json({ error: "Текущий пароль неверный" })
	}
	db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(next, 10), req.user.id)
	res.json({ ok: true })
})

api.get("/hotels", (_req, res) => res.json(db.prepare("SELECT * FROM hotels ORDER BY name").all()))
api.post("/hotels", requireRole("editor"), (req, res) => {
	const { name, location } = req.body || {}
	if (!name) return res.status(400).json({ error: "Укажите название" })
	const info = db.prepare("INSERT INTO hotels (name, location) VALUES (?,?)").run(name, location || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/hotels/:id", requireRole("editor"), (req, res) => {
	const { name, location } = req.body || {}
	db.prepare("UPDATE hotels SET name = ?, location = ? WHERE id = ?").run(name, location || null, req.params.id)
	res.json({ ok: true })
})
api.delete("/hotels/:id", requireRole("admin"), (req, res) => {
	db.prepare("DELETE FROM hotels WHERE id = ?").run(req.params.id)
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
	for (const room of rooms) room.beds = bedsStmt.all(room.id)
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
	db.prepare("DELETE FROM rooms WHERE id = ?").run(req.params.id)
	res.json({ ok: true })
})

api.get("/residents", (req, res) => {
	const q = `%${req.query.q || ""}%`
	res.json(
		db
			.prepare("SELECT * FROM residents WHERE full_name LIKE ? OR tab_number LIKE ? ORDER BY full_name")
			.all(q, q),
	)
})
api.get("/residents/:id/card", (req, res) => {
	const resident = db.prepare("SELECT * FROM residents WHERE id = ?").get(req.params.id)
	if (!resident) return res.status(404).json({ error: "Проживающий не найден" })
	const stays = db
		.prepare(
			`SELECT p.date_from, p.date_to, p.comment,
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
	db.prepare(
		"UPDATE residents SET full_name=?, tab_number=?, company=?, position=?, phone=?, note=? WHERE id=?",
	).run(full_name, tab_number || null, company || null, position || null, phone || null, note || null, req.params.id)
	res.json({ ok: true })
})
api.delete("/residents/:id", requireRole("editor"), (req, res) => {
	db.prepare("DELETE FROM residents WHERE id = ?").run(req.params.id)
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

function findConflict(bedId, from, to, excludeId) {
	return db
		.prepare(
			`SELECT p.date_from, p.date_to, COALESCE(r.full_name, s.name) AS who
			 FROM placements p
			 JOIN statuses s ON s.id = p.status_id
			 LEFT JOIN residents r ON r.id = p.resident_id
			 WHERE p.bed_id = ? AND p.id <> ? AND p.date_from <= ? AND p.date_to >= ?
			 LIMIT 1`,
		)
		.get(bedId, excludeId || 0, to, from)
}

api.post("/placements", requireRole("editor"), (req, res) => {
	const { bed_id, resident_id, status_id, date_from, date_to, comment } = req.body || {}
	if (!bed_id || !status_id || !date_from || !date_to) {
		return res.status(400).json({ error: "Заполните место, статус и даты" })
	}
	if (date_to < date_from) return res.status(400).json({ error: "Дата выезда раньше даты заезда" })
	const conflict = findConflict(bed_id, date_from, date_to)
	if (conflict) {
		return res.status(409).json({
			error: `Место занято: ${conflict.who} (${conflict.date_from} – ${conflict.date_to})`,
		})
	}
	const info = db
		.prepare("INSERT INTO placements (bed_id, resident_id, status_id, date_from, date_to, comment) VALUES (?,?,?,?,?,?)")
		.run(bed_id, resident_id || null, status_id, date_from, date_to, comment || null)
	res.json({ id: info.lastInsertRowid })
})
api.put("/placements/:id", requireRole("editor"), (req, res) => {
	const { resident_id, status_id, date_from, date_to, comment } = req.body || {}
	if (!status_id || !date_from || !date_to) return res.status(400).json({ error: "Заполните статус и даты" })
	if (date_to < date_from) return res.status(400).json({ error: "Дата выезда раньше даты заезда" })
	const current = db.prepare("SELECT bed_id FROM placements WHERE id = ?").get(req.params.id)
	if (!current) return res.status(404).json({ error: "Размещение не найдено" })
	const conflict = findConflict(current.bed_id, date_from, date_to, req.params.id)
	if (conflict) {
		return res.status(409).json({
			error: `Место занято: ${conflict.who} (${conflict.date_from} – ${conflict.date_to})`,
		})
	}
	db.prepare("UPDATE placements SET resident_id=?, status_id=?, date_from=?, date_to=?, comment=? WHERE id=?").run(
		resident_id || null,
		status_id,
		date_from,
		date_to,
		comment || null,
		req.params.id,
	)
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
			`SELECT p.date_from, p.date_to, p.comment, s.name AS status_name,
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

app.use("/api", api)
app.get("/kiosk", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "kiosk.html")))
app.use(express.static(path.join(__dirname, "..", "public")))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`NochOtel запущен: http://localhost:${PORT}`))
