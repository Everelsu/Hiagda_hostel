<script setup>
// Период одним полем: протяжка мышью по календарю (или клик–клик), два месяца рядом,
// быстрые кнопки «+15 / +30 ночей» под вахту. Значения — «ГГГГ-ММ-ДД».
//   nights (по умолчанию) — «to» это день выезда: ночи = to − from, минимум одна;
//   :nights="false" — обычный период, «to» включительно (аналитика, отчёты).
import { ref, computed, nextTick, onUnmounted } from "vue"
import Icon from "@/components/Icon.vue"
import { ymd, addDays, today as todayStr, nightsBetween, nightsWord } from "@/utils/date"

defineOptions({ inheritAttrs: false })
const from = defineModel("from", { type: String, default: "" })
const to = defineModel("to", { type: String, default: "" })
const props = defineProps({
	nights: { type: Boolean, default: true },
	presets: { type: Array, default: () => [7, 15, 30, 45, 60] },
	min: String,
	disabled: Boolean,
})
const emit = defineEmits(["change"])

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

const root = ref(null)
const panel = ref(null)
const open = ref(false)
const pos = ref({ left: 0, top: 0, up: false })
const view = ref({ y: 2026, m: 0 })
const anchor = ref("") // первый конец при выборе
const hover = ref("")
const dragging = ref(false)
const tFrom = ref("")
const tTo = ref("")

const d = (v) => new Date(`${v}T00:00:00`)
const show = (v) => (v ? v.split("-").reverse().join(".") : "")
const shortDate = (v, year) => d(v).toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) })
const count = computed(() => (from.value && to.value ? nightsBetween(from.value, to.value) + (props.nights ? 0 : 1) : 0))
const countText = computed(() => (props.nights ? `${count.value} ${nightsWord(count.value)}` : `${count.value} ${count.value % 10 === 1 && count.value % 100 !== 11 ? "день" : [2, 3, 4].includes(count.value % 10) && ![12, 13, 14].includes(count.value % 100) ? "дня" : "дней"}`))
const label = computed(() => {
	if (!from.value || !to.value) return "Выберите период"
	const sameYear = from.value.slice(0, 4) === to.value.slice(0, 4)
	return `${shortDate(from.value, !sameYear)} – ${shortDate(to.value, true)}`
})

function monthGrid(y, m) {
	const shift = (new Date(y, m, 1).getDay() + 6) % 7
	const start = ymd(new Date(y, m, 1 - shift))
	return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
const months = computed(() => {
	const a = view.value
	const b = new Date(a.y, a.m + 1, 1)
	return [
		{ y: a.y, m: a.m, cells: monthGrid(a.y, a.m) },
		{ y: b.getFullYear(), m: b.getMonth(), cells: monthGrid(b.getFullYear(), b.getMonth()) },
	]
})
// Что подсвечивать: во время выбора — от якоря до курсора, иначе текущий период
const span = computed(() => {
	if (anchor.value && hover.value) return [anchor.value, hover.value].sort()
	if (anchor.value) return [anchor.value, anchor.value]
	const end = props.nights && to.value ? addDays(to.value, -1) : to.value
	return from.value && end ? [from.value, end] : []
})
const t = todayStr()
function cls(v, m) {
	const [a, b] = span.value
	return {
		out: d(v).getMonth() !== m,
		we: [0, 6].includes(d(v).getDay()),
		today: v === t,
		inr: a && v > a && v < b,
		start: a && v === a,
		end: b && v === b,
		off: props.min && v < props.min,
	}
}

function place() {
	const r = root.value.getBoundingClientRect()
	const w = Math.min(560, window.innerWidth - 16)
	const h = 420
	const up = r.bottom + h > window.innerHeight && r.top > h
	pos.value = { left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: up ? r.top - 6 : r.bottom + 6, up }
}
async function toggle() {
	if (props.disabled) return
	if (open.value) return close()
	const base = from.value || t
	view.value = { y: d(base).getFullYear(), m: d(base).getMonth() }
	anchor.value = ""
	tFrom.value = show(from.value)
	tTo.value = show(to.value)
	place()
	open.value = true
	await nextTick()
	document.addEventListener("pointerdown", onOutside, true)
	document.addEventListener("keydown", onKey)
	window.addEventListener("resize", place)
	window.addEventListener("scroll", place, true)
}
function close() {
	open.value = false
	anchor.value = ""
	dragging.value = false
	document.removeEventListener("pointerdown", onOutside, true)
	document.removeEventListener("keydown", onKey)
	window.removeEventListener("resize", place)
	window.removeEventListener("scroll", place, true)
}
onUnmounted(close)
function onOutside(e) {
	if (!root.value?.contains(e.target) && !panel.value?.contains(e.target)) close()
}
function onKey(e) {
	if (e.key === "Escape") {
		e.preventDefault()
		close()
	}
}

function commit(a, b) {
	;[a, b] = [a, b].sort()
	// В режиме ночей выделенный последний день — последняя ночь, выезд на следующий день
	const end = props.nights ? addDays(b, 1) : b
	from.value = a
	to.value = end
	emit("change", { from: a, to: end })
	close()
}

// Протяжка: нажали на дне — якорь, отпустили на другом — готово.
// Нажали и отпустили на том же дне — ждём второго клика.
function down(v, e) {
	if (props.min && v < props.min) return
	e.preventDefault()
	if (anchor.value && !dragging.value) return commit(anchor.value, v) // второй клик
	anchor.value = v
	hover.value = v
	dragging.value = true
	document.addEventListener("pointerup", up, { once: true })
}
function enter(v) {
	if (anchor.value) hover.value = v
}
function up() {
	dragging.value = false
	if (anchor.value && hover.value && hover.value !== anchor.value) commit(anchor.value, hover.value)
}
function preset(n) {
	const a = from.value || t
	from.value = a
	to.value = addDays(a, props.nights ? n : n - 1)
	emit("change", { from: from.value, to: to.value })
	close()
}
function shift(n) {
	const x = new Date(view.value.y, view.value.m + n, 1)
	view.value = { y: x.getFullYear(), m: x.getMonth() }
}
function parse(s) {
	const m = /^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{2}|\d{4})$/.exec((s || "").trim())
	if (!m) return null
	const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
	const x = new Date(y, +m[2] - 1, +m[1])
	return x.getMonth() === +m[2] - 1 ? ymd(x) : null
}
function typed() {
	const a = parse(tFrom.value)
	const b = parse(tTo.value)
	if (!a || !b || b < a || (props.nights && b === a)) return
	from.value = a
	to.value = b
	emit("change", { from: a, to: b })
	close()
}
</script>

<template>
	<div ref="root" class="k-range" :class="[$attrs.class, { open, disabled }]" :style="$attrs.style">
		<button type="button" class="k-range__btn" :disabled="disabled" @click="toggle">
			<Icon name="calendar" class="k-range__ic" />
			<span class="k-range__label">{{ label }}</span>
			<span v-if="count > 0" class="k-range__count">{{ countText }}</span>
		</button>

		<Teleport to="body">
			<Transition name="k-range-pop">
				<div v-if="open" ref="panel" class="k-range__panel" :class="{ up: pos.up }" :style="{ left: pos.left + 'px', top: pos.top + 'px' }">
					<div class="k-range__inputs">
						<label>
							<span>{{ nights ? "Заезд" : "С" }}</span>
							<input v-model="tFrom" placeholder="дд.мм.гггг" inputmode="numeric" @keydown.enter="typed" />
						</label>
						<Icon name="arrow-right" class="muted" />
						<label>
							<span>{{ nights ? "Выезд" : "По" }}</span>
							<input v-model="tTo" placeholder="дд.мм.гггг" inputmode="numeric" @keydown.enter="typed" />
						</label>
						<span class="k-range__hint">{{ anchor ? "выберите второй день" : "протяните мышью по дням" }}</span>
					</div>

					<div class="k-range__months" @pointerleave="!dragging && (hover = anchor)">
						<div v-for="(mo, i) in months" :key="mo.y + '-' + mo.m" class="k-range__month">
							<div class="k-range__head">
								<button v-if="i === 0" type="button" class="k-range__nav" aria-label="Назад" @click="shift(-1)"><Icon name="chevron-left" /></button>
								<span v-else class="k-range__nav" />
								<b>{{ MONTHS[mo.m] }} {{ mo.y }}</b>
								<button v-if="i === 1" type="button" class="k-range__nav" aria-label="Вперёд" @click="shift(1)"><Icon name="chevron-right" /></button>
								<button v-else type="button" class="k-range__nav k-range__nav--mob" aria-label="Вперёд" @click="shift(1)"><Icon name="chevron-right" /></button>
							</div>
							<div class="k-range__grid">
								<span v-for="(w, j) in WEEK" :key="w" class="k-range__wd" :class="{ we: j > 4 }">{{ w }}</span>
								<button
									v-for="v in mo.cells"
									:key="v"
									type="button"
									class="k-range__day"
									:class="cls(v, mo.m)"
									:disabled="!!(min && v < min)"
									@pointerdown="down(v, $event)"
									@pointerenter="enter(v)"
								>
									{{ +v.slice(8) }}
								</button>
							</div>
						</div>
					</div>

					<div class="k-range__foot">
						<span class="muted">{{ nights ? "Ночей от заезда:" : "Дней:" }}</span>
						<button v-for="n in presets" :key="n" type="button" class="k-range__chip" :class="{ on: count === n }" @click="preset(n)">{{ n }}</button>
						<span class="k-range__grow" />
						<span v-if="count > 0" class="k-range__sum">{{ countText }}</span>
					</div>
				</div>
			</Transition>
		</Teleport>
	</div>
</template>

<style scoped>
.k-range {
	display: inline-flex;
	min-width: 0;
}
.k-range__btn {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	width: 100%;
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	cursor: pointer;
	white-space: nowrap;
	transition: border-color var(--speed-fast), box-shadow var(--speed-fast);
}
.k-range__btn:hover {
	border-color: color-mix(in srgb, var(--color-brand), var(--color-button-border) 50%);
}
.k-range.open .k-range__btn,
.k-range__btn:focus-visible {
	outline: none;
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.k-range__ic {
	color: var(--color-secondary);
}
.k-range__label {
	flex: 1;
	text-align: left;
	overflow: hidden;
	text-overflow: ellipsis;
	font-variant-numeric: tabular-nums;
}
.k-range__count {
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	color: var(--color-brand);
	background: var(--color-brand-highlight);
	border-radius: var(--radius-max);
	padding: 1px 8px;
}

.k-range__panel {
	position: fixed;
	z-index: calc(var(--z-popover) + 20);
	width: min(560px, calc(100vw - 16px));
	padding: var(--gap-md);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating), 0 18px 40px rgba(0, 0, 0, 0.35);
	user-select: none;
	touch-action: none;
}
.k-range__panel.up {
	transform: translateY(-100%);
}
.k-range__inputs {
	display: flex;
	align-items: flex-end;
	gap: var(--gap-sm);
	padding-bottom: var(--gap-md);
	margin-bottom: var(--gap-sm);
	border-bottom: 1px solid var(--color-divider);
	flex-wrap: wrap;
}
.k-range__inputs label {
	display: grid;
	gap: 2px;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.k-range__inputs input {
	width: 7.4rem;
	height: 2rem;
	padding: 0 var(--gap-sm);
	border-radius: var(--radius-sm);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	font-variant-numeric: tabular-nums;
}
.k-range__inputs input:focus {
	outline: none;
	border-color: var(--color-brand);
}
.k-range__inputs .ic {
	margin-bottom: 8px;
}
.k-range__hint {
	margin-left: auto;
	margin-bottom: 6px;
	font-size: var(--font-size-xs);
	color: var(--color-brand);
}
.k-range__months {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-lg);
}
.k-range__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 2rem;
	margin-bottom: 4px;
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
}
.k-range__nav {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
}
button.k-range__nav:hover {
	background: var(--color-button-bg);
	color: var(--color-contrast);
}
.k-range__grid {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	row-gap: 2px;
}
.k-range__wd {
	text-align: center;
	font-size: 0.66rem;
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	color: var(--color-secondary);
	padding: 2px 0 4px;
}
.k-range__wd.we {
	color: color-mix(in srgb, var(--color-red), var(--color-secondary) 45%);
}
.k-range__day {
	position: relative;
	height: 2.1rem;
	border: none;
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-sm);
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}
.k-range__day.we {
	color: color-mix(in srgb, var(--color-red), var(--color-contrast) 35%);
}
.k-range__day.out {
	visibility: hidden;
}
.k-range__day:hover:not(:disabled) {
	background: var(--color-button-bg);
	border-radius: var(--radius-sm);
}
.k-range__day.inr {
	background: var(--color-brand-highlight);
	border-radius: 0;
	color: var(--color-contrast);
}
.k-range__day.start,
.k-range__day.end {
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	font-weight: var(--font-weight-bold);
}
.k-range__day.start {
	border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.k-range__day.end {
	border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.k-range__day.start.end {
	border-radius: var(--radius-sm);
}
.k-range__day.today::after {
	content: "";
	position: absolute;
	left: 50%;
	bottom: 3px;
	width: 4px;
	height: 4px;
	margin-left: -2px;
	border-radius: 50%;
	background: var(--color-brand);
}
.k-range__day.start.today::after,
.k-range__day.end.today::after {
	background: var(--color-accent-contrast);
}
.k-range__day:disabled {
	opacity: 0.25;
	cursor: not-allowed;
}
.k-range__foot {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-top: var(--gap-sm);
	padding-top: var(--gap-sm);
	border-top: 1px solid var(--color-divider);
	font-size: var(--font-size-xs);
	flex-wrap: wrap;
}
.k-range__grow {
	flex: 1;
}
.k-range__chip {
	height: 1.75rem;
	min-width: 2.2rem;
	padding: 0 10px;
	border: 1px solid var(--color-button-border);
	border-radius: var(--radius-max);
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
}
.k-range__chip:hover,
.k-range__chip.on {
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.k-range__sum {
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.k-range-pop-enter-active,
.k-range-pop-leave-active {
	transition: opacity 120ms ease;
}
.k-range-pop-enter-from,
.k-range-pop-leave-to {
	opacity: 0;
}
.k-range__nav--mob {
	visibility: hidden;
}
@media (max-width: 600px) {
	.k-range__nav--mob {
		visibility: visible;
	}
	.k-range__months {
		grid-template-columns: 1fr;
	}
	.k-range__month:last-child {
		display: none;
	}
}
</style>
