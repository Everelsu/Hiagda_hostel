// Подсветка, которая переезжает к выбранному пункту (вкладки, сегменты).
// Движение показывает, что именно переключилось, — вместо мгновенной перекраски.
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue"

export function useIndicator(root, deps) {
	const style = ref({ opacity: 0 })
	let first = true
	function measure() {
		const el = root.value?.querySelector(".on")
		if (!el) return (style.value = { opacity: 0 })
		style.value = {
			opacity: 1,
			width: el.offsetWidth + "px",
			transform: `translateX(${el.offsetLeft}px)`,
			// Первый раз ставим без анимации — иначе ползунок «выезжает» из угла при загрузке
			transition: first ? "none" : undefined,
		}
		first = false
	}
	let ro = null
	onMounted(() => {
		nextTick(measure)
		ro = new ResizeObserver(() => measure())
		if (root.value) ro.observe(root.value)
	})
	onUnmounted(() => ro?.disconnect())
	watch(deps, () => nextTick(measure), { deep: true })
	return style
}
