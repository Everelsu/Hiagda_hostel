<script setup>
// Выбор даты вместо нативного <input type="date">: тот рисуется языком браузера
// (09/28/2026, неделя с воскресенья) и не стилизуется. Значение — «ГГГГ-ММ-ДД».
//   range — [с, по]: подсветить период (заезд–выезд)
//   min/max — границы; clearable — можно очистить
import { ref, computed, watch, nextTick, onUnmounted } from "vue"
import Icon from "@/components/Icon.vue"
import { ymd, today as todayStr, addDays } from "@/utils/date"

defineOptions({ inheritAttrs: false })
const model = defineModel({ type: String, default: "" })
const props = defineProps({
	min: String,
	max: String,
	range: { type: Array, default: null },
	placeholder: { type: String, default: "дд.мм.гггг" },
	clearable: Boolean,
	invalid: Boolean,
	disabled: Boolean,
})
const emit = defineEmits(["change"])

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

const root = ref(null)
const field = ref(null)
const panel = ref(null)
const open = ref(false)
const mode = ref("days") // days | months
const text = ref("")
const view = ref({ y: 2026, m: 0 }) // показываемый месяц
const cursor = ref("") // день под клавиатурным фокусом
const pos = ref({ top: 0, left: 0, up: false })

const show = (v) => (v ? v.split("-").reverse().join(".") : "")
watch(model, (v) => (text.value = show(v)), { immediate: true })

function parse(s) {
	const m = /^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{2}|\d{4})$/.exec(s.trim())
	if (!m) return null
	const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
	const d = new Date(y, +m[2] - 1, +m[1])
	return d.getMonth() === +m[2] - 1 ? ymd(d) : null
}
const allowed = (v) => (!props.min || v >= props.min) && (!props.max || v <= props.max)

function set(v) {
	if (v && !allowed(v)) return
	if (v !== model.value) {
		model.value = v
		emit("change", v)
	}
	text.value = show(v)
}

function viewOf(v) {
	const [y, m] = (v || todayStr()).split("-").map(Number)
	view.value = { y, m: m - 1 }
}
function place() {
	const r = field.value.getBoundingClientRect()
	const h = 330
	const up = r.bottom + h > window.innerHeight && r.top > h
	const left = Math.min(r.left, window.innerWidth - 292)
	pos.value = { left: Math.max(8, left), top: up ? r.top - 6 : r.bottom + 6, up }
}
async function openPanel() {
	if (props.disabled || open.value) return
	viewOf(model.value)
	cursor.value = model.value || todayStr()
	mode.value = "days"
	place()
	open.value = true
	await nextTick()
	document.addEventListener("pointerdown", onOutside, true)
	window.addEventListener("resize", place)
	window.addEventListener("scroll", place, true)
}
function close() {
	open.value = false
	document.removeEventListener("pointerdown", onOutside, true)
	window.removeEventListener("resize", place)
	window.removeEventListener("scroll", place, true)
}
onUnmounted(close)
function onOutside(e) {
	if (!root.value?.contains(e.target) && !panel.value?.contains(e.target)) {
		commitText()
		close()
	}
}
function commitText() {
	if (!text.value.trim()) return props.clearable ? set("") : (text.value = show(model.value))
	const v = parse(text.value)
	if (v && allowed(v)) set(v)
	else text.value = show(model.value)
}
function onInput() {
	const v = parse(text.value)
	if (v && text.value.trim().length >= 8) {
		viewOf(v)
		cursor.value = v
	}
}

const cells = computed(() => {
	const { y, m } = view.value
	const first = new Date(y, m, 1)
	const shift = (first.getDay() + 6) % 7 // с понедельника
	const start = ymd(new Date(y, m, 1 - shift))
	const [r0, r1] = props.range || []
	const t = todayStr()
	return Array.from({ length: 42 }, (_, i) => {
		const v = addDays(start, i)
		const d = new Date(`${v}T00:00:00`)
		return {
			v,
			day: d.getDate(),
			out: d.getMonth() !== m,
			weekend: d.getDay() === 0 || d.getDay() === 6,
			today: v === t,
			sel: v === model.value,
			inRange: r0 && r1 && v > r0 && v < r1,
			edge: (r0 && v === r0) || (r1 && v === r1),
			disabled: !allowed(v),
		}
	})
})

function shiftMonth(n) {
	const d = new Date(view.value.y, view.value.m + n, 1)
	view.value = { y: d.getFullYear(), m: d.getMonth() }
}
function pick(c) {
	if (c.disabled) return
	set(c.v)
	close()
	field.value?.focus()
}
function pickMonth(i) {
	view.value = { ...view.value, m: i }
	mode.value = "days"
}
function quick(n) {
	const v = addDays(todayStr(), n)
	set(v)
	close()
}

function onKey(e) {
	if (!open.value) {
		if (e.key === "ArrowDown" || (e.altKey && e.key === "ArrowDown")) (e.preventDefault(), openPanel())
		if (e.key === "Enter") commitText()
		return
	}
	const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
	if (e.key in moves && mode.value === "days") {
		e.preventDefault()
		cursor.value = addDays(cursor.value, moves[e.key])
		viewOf(cursor.value)
	} else if (e.key === "PageUp" || e.key === "PageDown") {
		e.preventDefault()
		const [y, m, d] = cursor.value.split("-").map(Number)
		const n = new Date(y, m - 1 + (e.key === "PageUp" ? -1 : 1), 1)
		cursor.value = ymd(new Date(n.getFullYear(), n.getMonth(), Math.min(d, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())))
		viewOf(cursor.value)
	} else if (e.key === "Enter") {
		e.preventDefault()
		// Набрали дату руками — берём её, иначе ту, что выбрана стрелками
		const typed = text.value !== show(model.value) ? parse(text.value) : null
		set(typed || cursor.value)
		close()
	} else if (e.key === "Escape") {
		e.stopPropagation()
		text.value = show(model.value)
		close()
	} else if (e.key === "Tab") {
		commitText()
		close()
	}
}

const label = computed(() => {
	if (!model.value) return ""
	const d = new Date(`${model.value}T00:00:00`)
	return d.toLocaleDateString("ru-RU", { weekday: "short" })
})
</script>

<template>
	<div ref="root" class="k-date" :class="[$attrs.class, { 'k-date--open': open, 'k-date--invalid': invalid, 'k-date--disabled': disabled }]" :style="$attrs.style" :title="$attrs.title">
		<input
			ref="field"
			v-model="text"
			class="k-date__input"
			inputmode="numeric"
			autocomplete="off"
			:placeholder="placeholder"
			:disabled="disabled"
			@click="openPanel"
			@input="onInput"
			@keydown="onKey"
		/>
		<span v-if="label && !open" class="k-date__wd">{{ label }}</span>
		<button type="button" class="k-date__btn" tabindex="-1" :disabled="disabled" aria-label="Открыть календарь" @click="open ? close() : (field.focus(), openPanel())">
			<Icon name="calendar" />
		</button>

		<Teleport to="body">
			<Transition name="k-date-pop">
				<div
					v-if="open"
					ref="panel"
					class="k-date__panel"
					:class="{ up: pos.up }"
					:style="{ left: pos.left + 'px', top: pos.top + 'px' }"
					@mousedown.prevent
				>
					<div class="k-date__head">
						<button type="button" class="k-date__nav" aria-label="Назад" @click="mode === 'days' ? shiftMonth(-1) : (view.y -= 1)"><Icon name="chevron-left" /></button>
						<button type="button" class="k-date__title" @click="mode = mode === 'days' ? 'months' : 'days'">
							{{ mode === "days" ? `${MONTHS[view.m]} ${view.y}` : view.y }}
							<Icon :name="mode === 'days' ? 'chevron-down' : 'chevron-up'" size="0.9em" />
						</button>
						<button type="button" class="k-date__nav" aria-label="Вперёд" @click="mode === 'days' ? shiftMonth(1) : (view.y += 1)"><Icon name="chevron-right" /></button>
					</div>

					<template v-if="mode === 'days'">
						<div class="k-date__week"><span v-for="(w, i) in WEEK" :key="w" :class="{ we: i > 4 }">{{ w }}</span></div>
						<div class="k-date__grid">
							<button
								v-for="c in cells"
								:key="c.v"
								type="button"
								class="k-date__day"
								:class="{ out: c.out, we: c.weekend, today: c.today, sel: c.sel, range: c.inRange, edge: c.edge && !c.sel, cur: c.v === cursor }"
								:disabled="c.disabled"
								@click="pick(c)"
							>
								{{ c.day }}
							</button>
						</div>
					</template>
					<div v-else class="k-date__months">
						<button
							v-for="(m, i) in MONTHS_SHORT"
							:key="m"
							type="button"
							class="k-date__month"
							:class="{ sel: model && +model.slice(0, 4) === view.y && +model.slice(5, 7) === i + 1 }"
							@click="pickMonth(i)"
						>
							{{ m }}
						</button>
					</div>

					<div class="k-date__foot">
						<button type="button" class="k-date__chip" @click="quick(-1)">Вчера</button>
						<button type="button" class="k-date__chip k-date__chip--main" @click="quick(0)">Сегодня</button>
						<button type="button" class="k-date__chip" @click="quick(1)">Завтра</button>
						<span class="k-date__grow" />
						<button v-if="clearable && model" type="button" class="k-date__chip" @click="set(''), close()">Очистить</button>
					</div>
				</div>
			</Transition>
		</Teleport>
	</div>
</template>

<style scoped>
.k-date {
	position: relative;
	display: inline-flex;
	align-items: center;
	width: 100%;
	min-width: 9.5rem;
	height: var(--control-h-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	transition: border-color var(--speed-fast), box-shadow var(--speed-fast);
}
.k-date:hover:not(.k-date--disabled) {
	border-color: color-mix(in srgb, var(--color-brand), var(--color-button-border) 50%);
}
.k-date--open,
.k-date:focus-within {
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.k-date--invalid {
	border-color: var(--color-red);
}
.k-date--disabled {
	opacity: 0.6;
}
.k-date__input {
	flex: 1;
	min-width: 0;
	width: 6.8rem;
	height: 100%;
	padding: 0 0 0 var(--gap-md);
	border: none;
	outline: none;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}
.k-date__input:focus {
	cursor: text;
}
.k-date__wd {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	pointer-events: none;
}
.k-date__btn {
	display: grid;
	place-items: center;
	width: var(--control-h-md);
	height: 100%;
	border: none;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	border-radius: 0 var(--radius-md) var(--radius-md) 0;
}
.k-date__btn:hover {
	color: var(--color-brand);
}

.k-date__panel {
	position: fixed;
	z-index: calc(var(--z-popover) + 20);
	width: 284px;
	padding: var(--gap-sm);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating), 0 18px 40px rgba(0, 0, 0, 0.35);
	user-select: none;
}
.k-date__panel.up {
	transform: translateY(-100%);
}
.k-date__head {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: var(--gap-xs);
}
.k-date__nav,
.k-date__title {
	height: 2rem;
	border: none;
	background: transparent;
	color: var(--color-contrast);
	border-radius: var(--radius-sm);
	cursor: pointer;
	font: inherit;
}
.k-date__nav {
	width: 2rem;
	display: grid;
	place-items: center;
	color: var(--color-secondary);
}
.k-date__title {
	flex: 1;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
}
.k-date__nav:hover,
.k-date__title:hover {
	background: var(--color-button-bg);
	color: var(--color-contrast);
}
.k-date__week,
.k-date__grid {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	gap: 2px;
}
.k-date__week span {
	text-align: center;
	font-size: 0.68rem;
	font-weight: var(--font-weight-bold);
	color: var(--color-secondary);
	padding: 4px 0;
	text-transform: uppercase;
}
.k-date__week .we {
	color: color-mix(in srgb, var(--color-red), var(--color-secondary) 45%);
}
.k-date__day {
	position: relative;
	height: 2.15rem;
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-sm);
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}
.k-date__day.we {
	color: color-mix(in srgb, var(--color-red), var(--color-contrast) 35%);
}
.k-date__day.out {
	opacity: 0.35;
}
.k-date__day:hover:not(:disabled),
.k-date__day.cur {
	background: var(--color-button-bg);
	color: var(--color-contrast);
}
.k-date__day.range {
	background: var(--color-brand-highlight);
	border-radius: 0;
}
.k-date__day.edge {
	box-shadow: inset 0 0 0 1.5px var(--color-brand);
}
.k-date__day.today::after {
	content: "";
	position: absolute;
	left: 50%;
	bottom: 4px;
	width: 4px;
	height: 4px;
	margin-left: -2px;
	border-radius: 50%;
	background: var(--color-brand);
}
.k-date__day.sel {
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	font-weight: var(--font-weight-bold);
}
.k-date__day.sel::after {
	background: var(--color-accent-contrast);
}
.k-date__day:disabled {
	opacity: 0.2;
	cursor: not-allowed;
}
.k-date__months {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 4px;
	padding: 4px 0;
}
.k-date__month {
	height: 2.6rem;
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-sm);
	cursor: pointer;
}
.k-date__month:hover {
	background: var(--color-button-bg);
	color: var(--color-contrast);
}
.k-date__month.sel {
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	font-weight: var(--font-weight-bold);
}
.k-date__foot {
	display: flex;
	gap: 4px;
	margin-top: var(--gap-sm);
	padding-top: var(--gap-sm);
	border-top: 1px solid var(--color-divider);
}
.k-date__grow {
	flex: 1;
}
.k-date__chip {
	height: 1.75rem;
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
.k-date__chip:hover {
	border-color: var(--color-brand);
	color: var(--color-contrast);
}
.k-date__chip--main {
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.k-date-pop-enter-active,
.k-date-pop-leave-active {
	transition: opacity 120ms ease, margin 120ms ease;
}
.k-date-pop-enter-from,
.k-date-pop-leave-to {
	opacity: 0;
	margin-top: -4px;
}
</style>
