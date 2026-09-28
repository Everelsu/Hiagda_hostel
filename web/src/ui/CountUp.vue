<script setup>
// Число, которое «досчитывается» до нового значения: видно, что цифра обновилась,
// а не просто мигнула. Понимает хвост вроде «17%» или «1 250 КБ» — анимирует число, хвост оставляет.
import { ref, watch, onMounted, onUnmounted } from "vue"

const props = defineProps({ value: { type: [Number, String], default: 0 }, duration: { type: Number, default: 650 } })
const shown = ref(String(props.value ?? ""))
let raf = 0
let from = 0

function parse(v) {
	const m = /^(-?\d[\d\s]*(?:[.,]\d+)?)(.*)$/.exec(String(v ?? "").trim())
	return m ? { n: Number(m[1].replace(/\s/g, "").replace(",", ".")), tail: m[2] } : null
}
function animate(to) {
	cancelAnimationFrame(raf)
	const p = parse(to)
	if (!p || matchMedia("(prefers-reduced-motion: reduce)").matches) {
		shown.value = String(to ?? "")
		from = p?.n ?? 0
		return
	}
	const start = performance.now()
	const a = from
	const decimals = String(p.n).includes(".") ? 1 : 0
	const step = (t) => {
		const k = Math.min(1, (t - start) / props.duration)
		const e = 1 - Math.pow(1 - k, 3)
		const n = a + (p.n - a) * e
		shown.value = (decimals ? n.toFixed(1) : Math.round(n).toLocaleString("ru-RU")) + p.tail
		if (k < 1) raf = requestAnimationFrame(step)
		else from = p.n
	}
	raf = requestAnimationFrame(step)
}
onMounted(() => animate(props.value))
watch(() => props.value, animate)
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
	<span class="k-count">{{ shown }}</span>
</template>

<style scoped>
.k-count {
	font-variant-numeric: tabular-nums;
}
</style>
