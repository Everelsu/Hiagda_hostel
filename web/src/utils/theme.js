// Смена темы с анимацией: новая тема «расходится кругом» от нажатой кнопки
// (View Transitions API). Где его нет — мягкий переход цветов. Один модуль на оба портала.
import { ref } from "vue"

export const theme = ref(document.documentElement.getAttribute("data-theme") || "dark")

function apply(next) {
	document.documentElement.setAttribute("data-theme", next)
	theme.value = next
	try {
		localStorage.setItem("noch_theme", next)
	} catch {}
	// Цвет строки состояния на телефоне — под тему
	document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#16181c" : "#f8f8f8")
}

export function setTheme(next, from) {
	if (next === theme.value) return
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
	if (reduce) return apply(next)
	if (!document.startViewTransition) {
		const root = document.documentElement
		root.classList.add("theme-anim")
		apply(next)
		setTimeout(() => root.classList.remove("theme-anim"), 450)
		return
	}
	const x = from?.x ?? window.innerWidth - 40
	const y = from?.y ?? 40
	const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
	const t = document.startViewTransition(() => apply(next))
	t.ready
		.then(() =>
			document.documentElement.animate(
				{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
				{ duration: 560, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
			),
		)
		.catch(() => {})
}

// e — событие клика: круг идёт из центра кнопки (с клавиатуры координаты нулевые)
export function toggleTheme(e) {
	const el = e?.currentTarget
	const r = el?.getBoundingClientRect?.()
	setTheme(theme.value === "dark" ? "light" : "dark", r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null)
}
