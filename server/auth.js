const jwt = require("jsonwebtoken")

const SECRET = process.env.JWT_SECRET || "nochotel-dev-secret-change-me"
// Иерархия прав персонала. viewer — это конечный пользователь (вахтовик), он НЕ персонал.
const ROLE_RANK = { editor: 1, admin: 2 }

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

module.exports = { sign, authenticate, requireRole, requireStaff, SECRET }
