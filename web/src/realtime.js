import { getToken } from "@/api/client"

let socket = null
let reconnectTimer = null
let manuallyClosed = false
const listeners = new Set()

function scheduleReconnect() {
	clearTimeout(reconnectTimer)
	if (!manuallyClosed && getToken()) reconnectTimer = setTimeout(connectRealtime, 2000)
}

export function connectRealtime() {
	if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING || !getToken()) return
	manuallyClosed = false
	const protocol = location.protocol === "https:" ? "wss:" : "ws:"
	socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(getToken())}`)
	socket.onmessage = (event) => {
		try {
			const message = JSON.parse(event.data)
			for (const listener of listeners) listener(message)
		} catch {
			// Ignore malformed messages so a reconnect can recover the connection.
		}
	}
	socket.onclose = scheduleReconnect
	socket.onerror = () => socket?.close()
}

export function disconnectRealtime() {
	manuallyClosed = true
	clearTimeout(reconnectTimer)
	socket?.close()
	socket = null
}

export function onRealtime(listener) {
	listeners.add(listener)
	connectRealtime()
	return () => listeners.delete(listener)
}
