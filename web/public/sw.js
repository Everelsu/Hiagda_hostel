// Сервис-воркер только для пуш-уведомлений: ничего не кэширует и не перехватывает запросы.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()))

self.addEventListener("push", (e) => {
	const d = e.data ? e.data.json() : {}
	e.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
			// Кабинет открыт и на экране — там уже всплыл тост, второе уведомление не нужно
			if (list.some((c) => c.focused && c.visibilityState === "visible")) return
			return self.registration.showNotification(d.title || "Хиагда", {
				body: d.body || "",
				tag: d.tag,
				renotify: !!d.tag,
				// PNG: SVG-иконки в уведомлениях Windows и Android не показываются
				icon: "/icon-192.png",
				badge: "/badge-96.png",
				data: { url: d.url || "/me" },
			})
		}),
	)
})

self.addEventListener("notificationclick", (e) => {
	e.notification.close()
	const url = e.notification.data?.url || "/me"
	e.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
			const tab = list.find((c) => "focus" in c)
			if (!tab) return self.clients.openWindow(url)
			return tab.focus().then((c) => c.navigate?.(url).catch(() => {}))
		}),
	)
})
