import { reactive } from "vue"

export const confirmState = reactive({ open: false, opts: {}, _resolve: null })

export function confirm(opts = {}) {
	return new Promise((resolve) => {
		confirmState.opts = {
			title: opts.title || "Подтвердите действие",
			message: opts.message || "",
			confirmLabel: opts.confirmLabel || "Подтвердить",
			cancelLabel: opts.cancelLabel || "Отмена",
			danger: !!opts.danger,
			// Для необратимых действий: кнопка активна, только когда введён этот текст
			typeText: opts.typeText || "",
		}
		confirmState._resolve = resolve
		confirmState.open = true
	})
}

export function resolveConfirm(value) {
	confirmState.open = false
	if (confirmState._resolve) confirmState._resolve(value)
	confirmState._resolve = null
}
