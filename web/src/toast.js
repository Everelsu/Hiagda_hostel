import { reactive } from "vue"

export const toasts = reactive([])
let nextId = 0

export function toast(message) {
	const t = { id: ++nextId, message }
	toasts.push(t)
	setTimeout(() => {
		const i = toasts.findIndex((x) => x.id === t.id)
		if (i >= 0) toasts.splice(i, 1)
	}, 2800)
}
