// Пуш-уведомления в браузере: подписать это устройство / отписать / узнать состояние.
import { api, post } from "@/api/client"

export const pushSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
// На iPhone пуши работают только у кабинета, добавленного на экран «Домой»
export const needsHomeScreen = /iPhone|iPad|iPod/.test(navigator.userAgent) && !matchMedia("(display-mode: standalone)").matches

async function currentSub() {
	const reg = await navigator.serviceWorker.getRegistration("/")
	return reg ? await reg.pushManager.getSubscription() : null
}

// "unsupported" | "denied" | "on" | "off"
export async function pushState() {
	if (!pushSupported) return "unsupported"
	if (Notification.permission === "denied") return "denied"
	return (await currentSub()) && Notification.permission === "granted" ? "on" : "off"
}

function keyBytes(b64) {
	const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"))
	return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

export async function enablePush() {
	if ((await Notification.requestPermission()) !== "granted") throw new Error("Уведомления не разрешены в браузере")
	await navigator.serviceWorker.register("/sw.js")
	const reg = await navigator.serviceWorker.ready
	const { key } = await api("/me/push")
	const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
	await post("/me/push", sub.toJSON())
}

export async function disablePush() {
	const sub = await currentSub()
	if (!sub) return
	await post("/me/push/off", { endpoint: sub.endpoint }).catch(() => {})
	await sub.unsubscribe()
}

// При выходе: устройство больше не получает уведомления этой учётки. Запрос с keepalive
// долетает до сервера, даже если страница уже перезагружается; ждём только локальную часть.
export async function dropPushOnLogout(token) {
	if (!pushSupported || !token) return
	try {
		const sub = await Promise.race([currentSub(), new Promise((r) => setTimeout(() => r(null), 300))])
		if (!sub) return
		fetch("/api/me/push/off", {
			method: "POST",
			keepalive: true,
			headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
			body: JSON.stringify({ endpoint: sub.endpoint }),
		}).catch(() => {})
		sub.unsubscribe().catch(() => {})
	} catch {}
}
