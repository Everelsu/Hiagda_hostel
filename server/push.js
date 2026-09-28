// Пуш-уведомления на телефон/компьютер (Web Push): объявления коменданта и ответы по заявкам
// приходят, даже когда кабинет закрыт. Ключи VAPID создаются сами при первом запуске и лежат
// в базе (попадают в бэкап — после восстановления подписки продолжают работать).
const webpush = require("web-push")
const db = require("./db")

let ready = null
async function init() {
	let row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get()
	if (!row) {
		const keys = webpush.generateVAPIDKeys()
		await db.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?) ON CONFLICT (key) DO NOTHING").run(JSON.stringify(keys))
		row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get()
	}
	const { publicKey, privateKey } = JSON.parse(row.value)
	// Apple и Mozilla требуют контакт владельца; задаётся в .env
	webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey)
	return publicKey
}
const publicKey = () => (ready ??= init().catch((e) => ((ready = null), Promise.reject(e))))

// payload: { title, body, url, tag }. Ошибки доставки не роняют запрос; мёртвые подписки удаляются.
async function send(userIds, payload) {
	const ids = [...new Set(userIds)].filter(Boolean)
	if (!ids.length) return
	const subs = await db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY(?)").all(ids)
	if (!subs.length) return
	await publicKey()
	const body = JSON.stringify(payload)
	await Promise.all(
		subs.map((s) =>
			webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400 }).catch(async (e) => {
				if (e.statusCode === 404 || e.statusCode === 410) await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id)
				else console.warn("push:", e.statusCode || e.message)
			}),
		),
	)
}

// Не ждём доставку в обработчике запроса
const notify = (userIds, payload) => send(userIds, payload).catch((e) => console.warn("push:", e.message))

module.exports = { publicKey, notify }
