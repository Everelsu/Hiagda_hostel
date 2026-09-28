const TOKEN_KEY = "noch_token"

export function getToken() {
	return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t) {
	if (t) localStorage.setItem(TOKEN_KEY, t)
	else localStorage.removeItem(TOKEN_KEY)
}

export async function api(path, opts = {}) {
	const token = getToken()
	const res = await fetch("/api" + path, {
		...opts,
		headers: {
			...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
			...(token ? { Authorization: "Bearer " + token } : {}),
			...(opts.headers || {}),
		},
	})
	// 401 без токена — это неудачный вход, а не истёкшая сессия: показываем ответ сервера.
	if (res.status === 401 && token) {
		window.dispatchEvent(new CustomEvent("noch:unauthorized"))
		throw new Error("Сессия истекла")
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}))
		throw new Error(body.error || "Ошибка запроса")
	}
	const ct = res.headers.get("content-type") || ""
	return ct.includes("application/json") ? res.json() : res
}

export async function download(path) {
    const res = await api(path)

    const blob = await res.blob()

    const cd = res.headers.get("Content-Disposition") || ""
    // filename* (UTF-8) приоритетнее: в нём русское имя без искажений
    const star = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1]
    const name = star ? decodeURIComponent(star) : (cd.match(/filename="(.+?)"/) || [])[1] || "download"

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()

    // Отзываем ссылку не сразу: часть браузеров не успевает начать скачивание
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const get = (p) => api(p)
export const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) })
export const put = (p, body) => api(p, { method: "PUT", body: JSON.stringify(body) })
export const del = (p) => api(p, { method: "DELETE" })

// Фото с телефона (3–8 МБ) ужимаем прямо в браузере: длинная сторона до maxSide,
// WebP (где браузер не умеет его сохранять, например Safari, — JPEG). Выходит 150–400 КБ:
// быстро грузится по слабой связи и не раздувает бэкапы. GIF/SVG и уже маленькие — как есть.
async function shrinkImage(file, maxSide) {
	if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || typeof createImageBitmap !== "function") return file
	let bmp
	try {
		bmp = await createImageBitmap(file, { imageOrientation: "from-image" }) // поворот по EXIF
	} catch {
		return file // формат, который браузер не открывает (HEIC в Chrome) — пусть решает сервер
	}
	const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
	if (k === 1 && file.size < 400 * 1024) return bmp.close(), file
	const c = document.createElement("canvas")
	c.width = Math.round(bmp.width * k)
	c.height = Math.round(bmp.height * k)
	c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height)
	bmp.close()
	const toBlob = (type, q) => new Promise((ok) => c.toBlob(ok, type, q))
	let blob = await toBlob("image/webp", 0.82)
	if (blob?.type !== "image/webp") blob = await toBlob("image/jpeg", 0.85)
	if (!blob || blob.size >= file.size) return file
	const ext = blob.type === "image/webp" ? "webp" : "jpg"
	return new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + ext, { type: blob.type })
}

// maxSide: 1600 — фото заявок и номеров; план этажа — крупнее (мелкий текст), аватар — меньше
export async function uploadFile(file, { maxSide = 1600 } = {}) {
	file = await shrinkImage(file, maxSide)
	const fd = new FormData()
	fd.append("file", file)
	const r = await api("/upload", { method: "POST", body: fd })
	return r.url
}
