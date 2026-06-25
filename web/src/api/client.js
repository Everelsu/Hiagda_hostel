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
	if (res.status === 401) {
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

export const get = (p) => api(p)
export const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) })
export const put = (p, body) => api(p, { method: "PUT", body: JSON.stringify(body) })
export const del = (p) => api(p, { method: "DELETE" })
