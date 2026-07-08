import { reactive } from "vue"

export const toasts = reactive([])
let nextId = 0

function push(message, variant) {
	const t = { id: ++nextId, message, variant }
	toasts.push(t)
	setTimeout(() => {
		const i = toasts.findIndex((x) => x.id === t.id)
		if (i >= 0) toasts.splice(i, 1)
	}, 3200)
	return t.id
}

export function toast(message, variant = "info") {
	return push(message, variant)
}
toast.success = (m) => push(m, "success")
toast.error = (m) => push(m, "error")
toast.info = (m) => push(m, "info")
