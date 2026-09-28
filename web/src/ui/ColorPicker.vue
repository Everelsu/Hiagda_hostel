<script setup>
// Выбор цвета в стиле приложения вместо системного окна Windows:
// готовые цвета, квадрат «насыщенность × яркость», полоса оттенка и поле HEX.
import { ref, computed, watch } from "vue"

const model = defineModel({ type: String, default: "#5fc8ff" })
const props = defineProps({ presets: { type: Array, default: () => [] } })

/* ---------- HSV ↔ HEX ---------- */
function hexToHsv(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
	if (!m) return { h: 200, s: 0.6, v: 1 }
	const n = parseInt(m[1], 16)
	const r = ((n >> 16) & 255) / 255
	const g = ((n >> 8) & 255) / 255
	const b = (n & 255) / 255
	const max = Math.max(r, g, b)
	const d = max - Math.min(r, g, b)
	let h = 0
	if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}
function hsvToHex({ h, s, v }) {
	const f = (n) => {
		const k = (n + h / 60) % 6
		return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
	}
	return "#" + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("")
}

const hsv = ref(hexToHsv(model.value))
const hexText = ref(model.value)
// Внешняя смена (клик по готовому цвету) — пересчитываем положение ползунков
watch(model, (v) => {
	if (v.toLowerCase() !== hsvToHex(hsv.value)) hsv.value = hexToHsv(v)
	hexText.value = v
})
function commit() {
	model.value = hsvToHex(hsv.value)
}

/* ---------- перетаскивание ---------- */
const sv = ref(null)
const hue = ref(null)
function drag(target, onPos) {
	return (e) => {
		const move = (ev) => {
			const r = target.value.getBoundingClientRect()
			onPos(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
			commit()
		}
		move(e)
		const up = () => {
			window.removeEventListener("pointermove", move)
			window.removeEventListener("pointerup", up)
		}
		window.addEventListener("pointermove", move)
		window.addEventListener("pointerup", up)
	}
}
const onSv = drag(sv, (x, y) => (hsv.value = { ...hsv.value, s: x, v: 1 - y }))
const onHue = drag(hue, (x) => (hsv.value = { ...hsv.value, h: x * 359 }))
// Стрелки на клавиатуре — для точной подстройки
function svKey(e) {
	const step = e.shiftKey ? 0.1 : 0.02
	const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
	if (!d) return
	e.preventDefault()
	hsv.value = { ...hsv.value, s: Math.min(1, Math.max(0, hsv.value.s + d[0])), v: Math.min(1, Math.max(0, hsv.value.v + d[1])) }
	commit()
}
function hueKey(e) {
	const d = { ArrowLeft: -5, ArrowRight: 5 }[e.key]
	if (!d) return
	e.preventDefault()
	hsv.value = { ...hsv.value, h: (hsv.value.h + d * (e.shiftKey ? 4 : 1) + 360) % 360 }
	commit()
}
function onHex() {
	let t = hexText.value.trim()
	if (!t.startsWith("#")) t = "#" + t
	if (/^#[0-9a-f]{3}$/i.test(t)) t = "#" + t.slice(1).split("").map((c) => c + c).join("")
	if (/^#[0-9a-f]{6}$/i.test(t)) model.value = t.toLowerCase()
}

const hueColor = computed(() => hsvToHex({ h: hsv.value.h, s: 1, v: 1 }))
</script>

<template>
	<div class="cp">
		<div v-if="props.presets.length" class="cp__presets">
			<button
				v-for="c in props.presets"
				:key="c"
				type="button"
				class="cp__preset"
				:class="{ on: model.toLowerCase() === c.toLowerCase() }"
				:style="{ background: c }"
				:aria-label="c"
				@click="model = c"
			/>
		</div>
		<div
			ref="sv"
			class="cp__sv"
			tabindex="0"
			aria-label="Насыщенность и яркость"
			:style="{ background: hueColor }"
			@pointerdown.prevent="onSv"
			@keydown="svKey"
		>
			<span class="cp__knob" :style="{ left: hsv.s * 100 + '%', top: (1 - hsv.v) * 100 + '%', background: model }" />
		</div>
		<div ref="hue" class="cp__hue" tabindex="0" aria-label="Оттенок" @pointerdown.prevent="onHue" @keydown="hueKey">
			<span class="cp__knob cp__knob--hue" :style="{ left: (hsv.h / 359) * 100 + '%', background: hueColor }" />
		</div>
		<div class="cp__row">
			<span class="cp__now" :style="{ background: model }" />
			<input v-model="hexText" class="cp__hex" maxlength="7" spellcheck="false" aria-label="Цвет HEX" @input="onHex" />
		</div>
	</div>
</template>

<style scoped>
.cp {
	display: grid;
	gap: var(--gap-sm);
	user-select: none;
}
.cp__presets {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.cp__preset {
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 50%;
	border: 2px solid transparent;
	box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
	cursor: pointer;
}
.cp__preset.on {
	border-color: var(--color-contrast);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.cp__sv {
	position: relative;
	height: 150px;
	border-radius: var(--radius-md);
	cursor: crosshair;
	touch-action: none;
	outline: none;
}
/* Поверх чистого оттенка: слева направо — белый→цвет, снизу вверх — чёрный→цвет */
.cp__sv::before {
	content: "";
	position: absolute;
	inset: 0;
	border-radius: inherit;
	background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
}
.cp__sv:focus-visible,
.cp__hue:focus-visible {
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.cp__hue {
	position: relative;
	height: 14px;
	border-radius: 999px;
	background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
	cursor: pointer;
	touch-action: none;
	outline: none;
}
.cp__knob {
	position: absolute;
	width: 18px;
	height: 18px;
	margin: -9px 0 0 -9px;
	border-radius: 50%;
	border: 3px solid #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
	pointer-events: none;
}
.cp__knob--hue {
	top: 50%;
}
.cp__row {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.cp__now {
	width: 2.25rem;
	height: var(--control-h-md);
	border-radius: var(--radius-md);
	box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.cp__hex {
	flex: 1;
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font-family: var(--font-mono);
	font-size: var(--font-size-sm);
	text-transform: uppercase;
}
.cp__hex:focus {
	outline: none;
	border-color: var(--color-brand);
}
</style>
