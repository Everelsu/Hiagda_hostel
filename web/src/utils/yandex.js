// Загрузка Яндекс Карт (JavaScript API 2.1) один раз на всё приложение.
// Ключ берём с сервера (.env → /api/public-config). Нет ключа или нет связи — null,
// и карта остаётся на OpenStreetMap/Esri.
let promise = null

export function loadYandex() {
	if (promise) return promise
	promise = (async () => {
		try {
			const { yandexMapsKey } = await (await fetch("/api/public-config")).json()
			if (!yandexMapsKey) return null
			await new Promise((resolve, reject) => {
				const s = document.createElement("script")
				s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(yandexMapsKey)}&lang=ru_RU`
				s.onload = resolve
				s.onerror = reject
				document.head.appendChild(s)
				setTimeout(() => reject(new Error("timeout")), 10000)
			})
			await new Promise((r) => window.ymaps.ready(r))
			return window.ymaps
		} catch {
			return null
		}
	})()
	return promise
}

// Выбор пользователя: «yandex» | «osm». По умолчанию — Яндекс, если он доступен
export function mapProvider() {
	try {
		return localStorage.getItem("map_provider") || "yandex"
	} catch {
		return "yandex"
	}
}
export function setMapProvider(p) {
	try {
		localStorage.setItem("map_provider", p)
	} catch {}
}

// Геокодер Яндекса: точнее по российским адресам. Бросает ошибку, если ключ его не включает —
// вызывающий код тогда идёт в OpenStreetMap.
export async function yandexGeocode(query, results = 6) {
	const ymaps = await loadYandex()
	if (!ymaps) throw new Error("no yandex")
	const res = await ymaps.geocode(query, { results })
	const out = []
	res.geoObjects.each((g) => {
		const [lat, lng] = g.geometry.getCoordinates()
		out.push({
			lat,
			lng,
			label: g.getAddressLine(),
			settlement: (g.getLocalities && g.getLocalities()[0]) || "",
			address: [g.getThoroughfare && g.getThoroughfare(), g.getPremiseNumber && g.getPremiseNumber()].filter(Boolean).join(", "),
		})
	})
	return out
}
