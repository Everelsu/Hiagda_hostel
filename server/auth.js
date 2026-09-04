const jwt = require("jsonwebtoken")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

// Секрет для подписи JWT. Приоритет: переменная окружения JWT_SECRET (для деплоя),
// иначе — случайный секрет, сохранённый в data/.jwtsecret (стабилен между перезапусками,
// не лежит в коде). Хардкод убран, чтобы токены нельзя было подделать по известному значению.
function resolveSecret() {
	if (process.env.JWT_SECRET) return process.env.JWT_SECRET
	const dir = path.join(__dirname, "..", "data")
	fs.mkdirSync(dir, { recursive: true })
	const file = path.join(dir, ".jwtsecret")
	try {
		const saved = fs.readFileSync(file, "utf8").trim()
		if (saved) return saved
	} catch {}
	const generated = crypto.randomBytes(32).toString("hex")
	try {
		fs.writeFileSync(file, generated, { mode: 0o600 })
	} catch {}
	return generated
}

const SECRET = resolveSecret()
// Иерархия прав персонала по «лестнице»: observer < editor < admin.
// maintenance (ремонтник) в лестницу не встраивается: он НЕ ведёт брони и номерной фонд,
// но обслуживает заявки и ремонт. Поэтому ранг у него как у наблюдателя (только чтение
// по лестнице), а право писать заявки и ремонт даёт отдельная проверка requireRepair.
// viewer (вахтовик) — не персонал, ранга нет вовсе.
const ROLE_RANK = { observer: 1, maintenance: 1, editor: 2, admin: 3 }
const REPAIR_ROLES = new Set(["maintenance", "editor", "admin"])

function sign(user) {
	return jwt.sign(
		{ id: user.id, username: user.username, role: user.role, resident_id: user.resident_id ?? null },
		SECRET,
		{ expiresIn: "12h" },
	)
}

function authenticate(req, res, next) {
	const header = req.headers.authorization || ""
	const token = header.startsWith("Bearer ") ? header.slice(7) : null
	if (!token) return res.status(401).json({ error: "Требуется авторизация" })
	try {
		req.user = jwt.verify(token, SECRET)
		next()
	} catch {
		res.status(401).json({ error: "Сессия недействительна" })
	}
}

function requireRole(minRole) {
	return (req, res, next) => {
		if (!req.user || (ROLE_RANK[req.user.role] || 0) < ROLE_RANK[minRole]) {
			return res.status(403).json({ error: "Недостаточно прав" })
		}
		next()
	}
}

function requireStaff(req, res, next) {
	if (!req.user || !ROLE_RANK[req.user.role]) {
		return res.status(403).json({ error: "Доступ только для персонала" })
	}
	next()
}

// Обслуживание заявок и ремонта: ремонтник, редактор, администратор
function requireRepair(req, res, next) {
	if (!req.user || !REPAIR_ROLES.has(req.user.role)) {
		return res.status(403).json({ error: "Доступ только для ремонтной службы" })
	}
	next()
}

const canRepair = (user) => !!user && REPAIR_ROLES.has(user.role)

module.exports = { sign, authenticate, requireRole, requireStaff, requireRepair, canRepair, SECRET }
