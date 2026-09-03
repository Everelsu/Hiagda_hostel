const jwt = require("jsonwebtoken")
const { WebSocketServer, WebSocket } = require("ws")
const { SECRET } = require("./auth")

const STAFF_ROLES = new Set(["admin", "editor", "observer"])

function createRealtimeServer(server) {
	const clients = new Set()
	const wss = new WebSocketServer({ noServer: true })

	server.on("upgrade", (req, socket, head) => {
		const url = new URL(req.url, "http://localhost")
		if (url.pathname !== "/ws") return

		const token = url.searchParams.get("token")
		let user
		try {
			user = jwt.verify(token, SECRET)
		} catch {
			socket.destroy()
			return
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			ws.user = user
			clients.add(ws)
			ws.on("close", () => clients.delete(ws))
			ws.send(JSON.stringify({ type: "ready" }))
		})
	})

	function broadcast(type, payload = {}, canReceive = () => true) {
		const message = JSON.stringify({ type, ...payload })
		for (const client of clients) {
			if (client.readyState === WebSocket.OPEN && canReceive(client.user)) client.send(message)
		}
	}

	return {
		broadcast,
		staff(type, payload) {
			broadcast(type, payload, (user) => STAFF_ROLES.has(user.role))
		},
	}
}

module.exports = { createRealtimeServer, STAFF_ROLES }
