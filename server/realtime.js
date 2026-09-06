const jwt = require("jsonwebtoken")
const { WebSocketServer, WebSocket } = require("ws")
const { SECRET } = require("./auth")

// Весь персонал, включая ремонтную службу: заявки и снятые с продажи номера её касаются
// напрямую, без неё ремонтник не получал ни одного живого уведомления.
const STAFF_ROLES = new Set(["admin", "editor", "observer", "maintenance"])

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
			ws.alive = true
			clients.add(ws)
			ws.on("close", () => clients.delete(ws))
			// Без слушателя 'error' обрыв соединения роняет весь процесс сервера.
			ws.on("error", () => {
				clients.delete(ws)
				ws.terminate()
			})
			ws.on("pong", () => (ws.alive = true))
			ws.send(JSON.stringify({ type: "ready" }))
		})
	})

	// Оборванные соединения (закрытая крышка ноутбука, обрыв связи) сами о себе не сообщают —
	// вычищаем их пингом, иначе список клиентов растёт до перезапуска сервера.
	const heartbeat = setInterval(() => {
		for (const client of clients) {
			if (!client.alive) {
				clients.delete(client)
				client.terminate()
				continue
			}
			client.alive = false
			client.ping()
		}
	}, 30000)
	heartbeat.unref?.()
	wss.on("close", () => clearInterval(heartbeat))

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
