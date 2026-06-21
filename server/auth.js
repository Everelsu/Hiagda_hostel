const jwt = require("jsonwebtoken")

const SECRET = process.env.JWT_SECRET || "nochotel-dev-secret-change-me"
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 }

function sign(user) {
	return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, {
		expiresIn: "12h",
	})
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
		if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
			return res.status(403).json({ error: "Недостаточно прав" })
		}
		next()
	}
}

module.exports = { sign, authenticate, requireRole, SECRET }
