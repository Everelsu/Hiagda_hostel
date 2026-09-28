import { reactive } from "vue"

export const toasts = reactive([])
let nextId = 0

export function dismissToast(id) {
	const i = toasts.findIndex((x) => x.id === id)
	if (i >= 0) toasts.splice(i, 1)
}

function push(message, variant, action = null, ms = 3200) {
	const t = { id: ++nextId, message, variant, action }
	toasts.push(t)
	setTimeout(() => dismissToast(t.id), ms)
	return t.id
}

export function toast(message, variant = "info") {
	return push(message, variant)
}
toast.success = (m) => push(m, "success")
toast.error = (m) => push(m, "error")
toast.info = (m) => push(m, "info")
// Тост с кнопкой (например «Отменить» после переноса брони) — висит дольше, чтобы успеть нажать
toast.action = (m, label, run, variant = "success") => push(m, variant, { label, run }, 7000)
