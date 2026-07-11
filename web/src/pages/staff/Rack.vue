<script setup>
import { ref, onMounted, onUnmounted, computed, reactive, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { api, post, put } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"
import { PageHeader, FilterBar, Field, Select, Input, Button, StatusDot, confirm } from "@/ui"

const COL = 40
const ROW = 34
const NUM = 96
const BED = 64
const LEFT = NUM + BED
const HEAD = 80

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const canEdit = auth.can("editor")

const hotels = ref([])
const statuses = ref([])
const hotelId = ref(null)
const from = ref(route.query.from || ymd(new Date()))
const span = ref(Number(route.query.span) || 30)
const classFilter = ref("")

const data = ref({ rooms: [], placements: [], blocks: [] })
const loading = ref(false)
const placement = ref(null)

const todayStr = ymd(new Date())
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
const MONTHS = ["янв.", "фев.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сен.", "окт.", "ноя.", "дек."]
const MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

function ymd(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function parse(s) {
	const [y, m, d] = s.split("-").map(Number)
	return new Date(y, m - 1, d)
}
function addDays(s, n) {
	const d = parse(s)
	d.setDate(d.getDate() + n)
	return ymd(d)
}
function dayDiff(a, b) {
	return Math.round((parse(b) - parse(a)) / 86400000)
}

const days = computed(() => Array.from({ length: span.value }, (_, i) => addDays(from.value, i)))
const dayInfo = computed(() =>
	days.value.map((d) => {
		const dt = parse(d)
		return { date: d, dow: dt.getDay(), num: dt.getDate(), wd: WD[dt.getDay()], weekend: dt.getDay() === 0 || dt.getDay() === 6, today: d === todayStr }
	}),
)
const monthSpans = computed(() => {
	const out = []
	for (const di of dayInfo.value) {
		const dt = parse(di.date)
		const label = `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`
		const last = out[out.length - 1]
		if (last && last.label === label) last.colspan++
		else out.push({ label, colspan: 1, key: label })
	}
	return out
})

const rooms = computed(() => {
	if (!classFilter.value) return data.value.rooms
	return data.value.rooms.filter((r) => r.class_name === classFilter.value)
})
const classOptions = computed(() => [...new Set(data.value.rooms.map((r) => r.class_name).filter(Boolean))])

// Плоский список коек с глобальным индексом строки + признак первой койки номера.
const flatBeds = computed(() => {
	const out = []
	for (const room of rooms.value) {
		const beds = room.beds || []
		beds.forEach((bed, i) => out.push({ room, bed, rowIndex: out.length, first: i === 0, rowspan: beds.length }))
	}
	return out
})
const bedRow = computed(() => {
	const m = new Map()
	flatBeds.value.forEach((f) => m.set(f.bed.id, f.rowIndex))
	return m
})

function contrastText(hex) {
	const h = (hex || "").replace("#", "")
	if (h.length < 6) return "#0c0c0c"
	const r = parseInt(h.slice(0, 2), 16)
	const g = parseInt(h.slice(2, 4), 16)
	const b = parseInt(h.slice(4, 6), 16)
	return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0c0c0c" : "#ffffff"
}

// Ядро: раскладка лент, блокировок, занятости, свободных мест — один проход.
const layout = computed(() => {
	const s = span.value
	const bedRowMap = bedRow.value
	const validBeds = new Set(flatBeds.value.map((f) => f.bed.id))
	const roomFirstRow = new Map()
	for (const f of flatBeds.value) if (f.first) roomFirstRow.set(f.room.id, { top: f.rowIndex, height: f.rowspan })

	const occ = new Map() // bedId -> Set(col) занятые ночи
	const blk = new Map() // bedId -> Set(col) ремонт
	const cellPl = new Map() // bedId -> Map(col -> placement)
	const ribbons = []
	const bands = []

	for (const p of data.value.placements) {
		if (p.stage === "cancelled" || !validBeds.has(p.bed_id)) continue
		const startOff = dayDiff(from.value, p.date_from)
		const endOff = dayDiff(from.value, p.date_to)
		const leftPx = startOff >= 0 ? (startOff + 0.5) * COL : 0
		const roundL = startOff >= 0
		const roundR = endOff <= s - 1
		const rightPx = endOff <= s - 1 ? (endOff + 0.5) * COL : s * COL
		const width = Math.max(rightPx - leftPx, COL * 0.5)
		const label = p.resident_name || p.status_name
		ribbons.push({
			id: p.id,
			p,
			row: bedRowMap.get(p.bed_id),
			leftPx,
			width,
			roundL,
			roundR,
			color: p.status_color,
			text: contrastText(p.status_color),
			label,
			stage: p.stage,
			nights: dayDiff(p.date_from, p.date_to),
		})
		const c0 = Math.max(0, startOff)
		const c1 = Math.min(s - 1, endOff - 1)
		if (!occ.has(p.bed_id)) occ.set(p.bed_id, new Set())
		if (!cellPl.has(p.bed_id)) cellPl.set(p.bed_id, new Map())
		for (let c = c0; c <= c1; c++) {
			occ.get(p.bed_id).add(c)
			cellPl.get(p.bed_id).set(c, p)
		}
	}

	for (const b of data.value.blocks) {
		const fr = roomFirstRow.get(b.room_id)
		if (!fr) continue
		const startOff = dayDiff(from.value, b.date_from)
		const endOff = dayDiff(from.value, b.date_to)
		const c0 = Math.max(0, startOff)
		const c1 = Math.min(s - 1, endOff)
		if (c1 < c0) continue
		bands.push({
			id: b.id,
			top: fr.top * ROW,
			height: fr.height * ROW,
			leftPx: c0 * COL,
			width: (c1 - c0 + 1) * COL,
			reason: b.reason,
		})
		for (const f of flatBeds.value) {
			if (f.room.id !== b.room_id) continue
			if (!blk.has(f.bed.id)) blk.set(f.bed.id, new Set())
			for (let c = c0; c <= c1; c++) blk.get(f.bed.id).add(c)
		}
	}

	const totalBeds = flatBeds.value.length
	const freePerDay = Array.from({ length: s }, (_, c) => {
		let free = 0
		for (const f of flatBeds.value) {
			if (occ.get(f.bed.id)?.has(c)) continue
			if (blk.get(f.bed.id)?.has(c)) continue
			free++
		}
		return totalBeds ? free : 0
	})

	const todayOff = dayDiff(from.value, todayStr)
	const todayX = todayOff >= 0 && todayOff < s ? (todayOff + 0.5) * COL : null

	return { ribbons, bands, occ, blk, cellPl, freePerDay, totalBeds, todayX, height: totalBeds * ROW }
})

const lowThresh = computed(() => Math.max(1, Math.round(layout.value.totalBeds * 0.2)))

async function load() {
	if (!hotelId.value) return
	loading.value = true
	try {
		const to = days.value[days.value.length - 1]
		data.value = await api(`/rack?hotel_id=${hotelId.value}&from=${from.value}&to=${to}`)
	} finally {
		loading.value = false
	}
	syncUrl()
}
function syncUrl() {
	router.replace({ query: { ...route.query, hotel_id: hotelId.value, from: from.value, span: span.value } }).catch(() => {})
}

onMounted(async () => {
	;[hotels.value, statuses.value] = await Promise.all([api("/hotels"), api("/statuses")])
	hotelId.value = Number(route.query.hotel_id) || hotels.value[0]?.id
	await load()
	window.addEventListener("mousemove", onMove)
	window.addEventListener("mouseup", onUp)
})
onUnmounted(() => {
	window.removeEventListener("mousemove", onMove)
	window.removeEventListener("mouseup", onUp)
})

function shiftFrom(delta) {
	from.value = addDays(from.value, delta)
	load()
}
function goToday() {
	from.value = todayStr
	load()
}
function fullDate(d) {
	const dt = parse(d)
	return `${WD[dt.getDay()]}, ${dt.getDate()} ${MONTHS_FULL[dt.getMonth()]} ${dt.getFullYear()}`
}

/* ---------- взаимодействия (координатная модель) ---------- */
const scrollEl = ref(null)
const mode = ref(null) // 'pan' | 'select' | 'ribbon'
let moved = false
let panStart = null
let ribbonCandidate = null
const sel = reactive({ active: false, bedId: null, row: 0, a: 0, b: 0 })

function locate(clientX, clientY) {
	const el = scrollEl.value
	if (!el) return null
	const rect = el.getBoundingClientRect()
	const x = clientX - rect.left + el.scrollLeft
	const y = clientY - rect.top + el.scrollTop
	if (x < LEFT || y < HEAD) return { region: "frozen" }
	const col = Math.floor((x - LEFT) / COL)
	const row = Math.floor((y - HEAD) / ROW)
	const f = flatBeds.value[row]
	if (col < 0 || col >= span.value || !f) return { region: "outside" }
	const p = layout.value.cellPl.get(f.bed.id)?.get(col) || null
	const blocked = layout.value.blk.get(f.bed.id)?.has(col) || false
	return { region: "grid", col, row, f, placement: p, blocked, rect }
}

function onDown(e) {
	const loc = locate(e.clientX, e.clientY)
	moved = false
	hidePopover(true)
	if (e.button === 1 || !loc || loc.region !== "grid") return startPan(e)
	if (loc.placement) {
		ribbonCandidate = loc.placement
		mode.value = "ribbon"
		return
	}
	if (canEdit && !loc.blocked) {
		mode.value = "select"
		sel.active = true
		sel.bedId = loc.f.bed.id
		sel.row = loc.row
		sel.a = loc.col
		sel.b = loc.col
		e.preventDefault()
		return
	}
	startPan(e)
}
function startPan(e) {
	mode.value = "pan"
	panStart = { x: e.clientX, y: e.clientY, left: scrollEl.value.scrollLeft, top: scrollEl.value.scrollTop }
}
function onMove(e) {
	if (mode.value === "pan" && panStart) {
		const dx = e.clientX - panStart.x
		const dy = e.clientY - panStart.y
		if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true
		scrollEl.value.scrollLeft = panStart.left - dx
		scrollEl.value.scrollTop = panStart.top - dy
		return
	}
	if (mode.value === "select" && sel.active) {
		const loc = locate(e.clientX, e.clientY)
		if (!loc || loc.region !== "grid") return
		let target = loc.col
		const dir = target >= sel.a ? 1 : -1
		let b = sel.a
		for (let c = sel.a + dir; dir > 0 ? c <= target : c >= target; c += dir) {
			if (layout.value.occ.get(sel.bedId)?.has(c) || layout.value.blk.get(sel.bedId)?.has(c)) break
			b = c
		}
		if (b !== sel.b) moved = true
		sel.b = b
		return
	}
	if (mode.value === null) hover(e)
}
function onUp() {
	if (mode.value === "select" && sel.active) {
		const a = Math.min(sel.a, sel.b)
		const b = Math.max(sel.a, sel.b)
		const f = flatBeds.value[sel.row]
		if (f) placement.value = { bed: { id: f.bed.id, label: `${f.room.number} · ${f.bed.label}` }, existing: null, date: days.value[a], dateTo: addDays(days.value[b], 1) }
	} else if (mode.value === "ribbon" && !moved && ribbonCandidate) {
		openPlacement(ribbonCandidate)
	}
	mode.value = null
	sel.active = false
	ribbonCandidate = null
	setTimeout(() => (moved = false), 0)
}

function openPlacement(p) {
	const f = flatBeds.value.find((x) => x.bed.id === p.bed_id)
	placement.value = { bed: { id: p.bed_id, label: f ? `${f.room.number} · ${f.bed.label}` : "" }, existing: p, date: p.date_from }
}
function onSaved() {
	placement.value = null
	load()
}

/* ---------- поповер ленты ---------- */
const pop = reactive({ show: false, p: null, x: 0, y: 0, above: false })
let popTimer = null
let hideTimer = null

function hover(e) {
	const loc = locate(e.clientX, e.clientY)
	if (loc?.region === "grid" && loc.placement) {
		if (pop.p === loc.placement) return
		clearTimeout(popTimer)
		clearTimeout(hideTimer)
		popTimer = setTimeout(() => showPopover(loc.placement, e.clientX, e.clientY), 140)
	} else {
		schedulePopHide()
	}
}
function showPopover(p, x, y) {
	pop.p = p
	pop.show = true
	pop.above = y > window.innerHeight - 220
	pop.x = Math.min(x, window.innerWidth - 280)
	pop.y = pop.above ? y - 12 : y + 16
}
function schedulePopHide() {
	if (!pop.show) return
	clearTimeout(hideTimer)
	hideTimer = setTimeout(() => (pop.show = false), 220)
}
function hidePopover(now) {
	clearTimeout(popTimer)
	clearTimeout(hideTimer)
	if (now) pop.show = false
}
function keepPopover() {
	clearTimeout(hideTimer)
}

const STAGE_ACTIONS = {
	expected: [{ to: "checked_in", label: "Заселить", icon: "check", variant: "primary" }],
	checked_in: [{ to: "checked_out", label: "Выселить", icon: "log-out" }],
	checked_out: [{ to: "checked_in", label: "Вернуть", icon: "rotate-cw" }],
}
async function quickStage(p, stage) {
	try {
		await post(`/placements/${p.id}/stage`, { stage })
		p.stage = stage
		toast.success("Стадия обновлена")
	} catch (e) {
		toast.error(e.message)
	}
}
async function cancelBooking(p) {
	if (!(await confirm({ title: "Отменить бронь?", message: `${p.resident_name || p.status_name}, ${p.date_from} – ${p.date_to}`, danger: true, confirmLabel: "Отменить" }))) return
	try {
		await put(`/placements/${p.id}`, { resident_id: p.resident_id, status_id: p.status_id, stage: "cancelled", date_from: p.date_from, date_to: p.date_to, comment: p.comment })
		pop.show = false
		load()
	} catch (e) {
		toast.error(e.message)
	}
}
const STAGE_LABEL = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал" }

watch([hotelId], () => {})

const gridStyle = computed(() => ({
	"--rack-col": COL + "px",
	"--rack-row": ROW + "px",
	"--rack-num": NUM + "px",
	"--rack-bed": BED + "px",
	width: LEFT + span.value * COL + "px",
}))
const selStyle = computed(() => {
	if (!sel.active) return null
	const a = Math.min(sel.a, sel.b)
	const b = Math.max(sel.a, sel.b)
	return { top: sel.row * ROW + "px", left: a * COL + "px", width: (b - a + 1) * COL + "px", height: ROW + "px" }
})
</script>

<template>
	<div class="grid">
		<PageHeader title="Бронирование" subtitle="Тяните по свободным клеткам — бронь; по ленте — детали; по фону — листать" icon="calendar" />

		<FilterBar>
			<Field label="Гостиница"><Select v-model="hotelId" @change="load"><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select></Field>
			<Field label="С даты"><Input v-model="from" type="date" @change="load" /></Field>
			<Field label="Период"><Select v-model.number="span" @change="load"><option :value="7">7 дней</option><option :value="14">14 дней</option><option :value="30">30 дней</option><option :value="60">60 дней</option></Select></Field>
			<Field label="Класс"><Select v-model="classFilter"><option value="">Все типы</option><option v-for="c in classOptions" :key="c" :value="c">{{ c }}</option></Select></Field>
			<Button size="sm" @click="goToday">Сегодня</Button>
			<Button size="sm" icon="chevron-left" @click="shiftFrom(-7)">Неделя</Button>
			<Button size="sm" @click="shiftFrom(7)">Неделя ›</Button>
			<span class="grow" />
			<div class="legend">
				<span v-for="s in statuses" :key="s.id" class="leg"><StatusDot :color="s.color" /> {{ s.name }}</span>
				<span class="leg"><span class="pat pat-exp" /> ожидается</span>
				<span class="leg"><span class="pat pat-in" /> проживает</span>
				<span class="leg"><span class="pat pat-blk" /> ремонт</span>
			</div>
		</FilterBar>

		<div v-if="loading && !data.rooms.length" class="muted">Загрузка…</div>
		<div v-else-if="!rooms.length" class="card" style="text-align: center; padding: var(--gap-xl)">
			<p class="muted" style="margin: 0">В этой гостинице нет номеров.</p>
			<Button variant="primary" icon="plus" to="/app/hotels" style="margin-top: var(--gap-md)">Добавить номер</Button>
		</div>

		<div v-else ref="scrollEl" class="rack-scroll" :class="{ grabbing: mode === 'pan', selecting: mode === 'select', loading }" @mousedown="onDown" @mouseleave="hidePopover(true)">
			<div class="rack-grid" :style="gridStyle">
				<!-- Слой лент (под таблицей) -->
				<div class="ribbon-layer" :style="{ left: LEFT + 'px', top: HEAD + 'px', height: layout.height + 'px' }">
					<div v-for="b in layout.bands" :key="'b' + b.id" class="band" :style="{ top: b.top + 'px', height: b.height + 'px', left: b.leftPx + 'px', width: b.width + 'px' }">
						<span v-if="b.reason" class="band-txt">{{ b.reason }}</span>
					</div>
					<div v-if="layout.todayX != null" class="today-line" :style="{ left: layout.todayX + 'px', height: layout.height + 'px' }" />
					<div
						v-for="r in layout.ribbons"
						:key="'r' + r.id"
						class="ribbon"
						:class="['st-' + r.stage, { rl: r.roundL, rr: r.roundR }]"
						:style="{ top: r.row * ROW + 3 + 'px', left: r.leftPx + 'px', width: r.width + 'px', height: ROW - 6 + 'px', '--rc': r.color, color: r.text }"
					>
						<span class="ribbon-txt">{{ r.label }}</span>
					</div>
					<div v-if="selStyle" class="sel" :style="selStyle" />
				</div>

				<!-- Сетка -->
				<table class="rack">
					<colgroup>
						<col :style="{ width: NUM + 'px' }" />
						<col :style="{ width: BED + 'px' }" />
						<col v-for="d in days" :key="'c' + d" :style="{ width: COL + 'px' }" />
					</colgroup>
					<thead>
						<tr>
							<th class="corner" rowspan="2" colspan="2">Номер · место</th>
							<th v-for="m in monthSpans" :key="m.key" class="mcell" :colspan="m.colspan">{{ m.label }}</th>
						</tr>
						<tr>
							<th v-for="d in dayInfo" :key="'d' + d.date" class="dcell" :class="{ weekend: d.weekend, today: d.today }" :title="fullDate(d.date)">
								<span class="wd">{{ d.wd }}</span><span class="dd">{{ d.num }}</span>
							</th>
						</tr>
						<tr class="free-row">
							<th class="free-lbl" colspan="2">свободно</th>
							<th v-for="(f, i) in layout.freePerDay" :key="'f' + i" class="fcell" :class="{ zero: f === 0, low: f > 0 && f <= lowThresh, weekend: dayInfo[i].weekend }">{{ f }}</th>
						</tr>
					</thead>
					<tbody>
						<template v-for="f in flatBeds" :key="f.bed.id">
							<tr>
								<th v-if="f.first" class="numcell" :rowspan="f.rowspan">
									<div class="num">№ {{ f.room.number }}</div>
									<div class="cls">{{ f.room.class_name || "—" }}</div>
								</th>
								<th class="bedcell">{{ f.bed.label }}</th>
								<td v-for="d in dayInfo" :key="'x' + f.bed.id + d.date" class="cell" :class="{ weekend: d.weekend, today: d.today }" />
							</tr>
						</template>
					</tbody>
				</table>
			</div>
		</div>

		<!-- Поповер ленты -->
		<div v-if="pop.show && pop.p" class="pop" :class="{ above: pop.above }" :style="{ left: pop.x + 'px', top: pop.y + 'px' }" @mouseenter="keepPopover" @mouseleave="schedulePopHide">
			<div class="pop-head">
				<StatusDot :color="pop.p.status_color" size="12px" />
				<b class="contrast">{{ pop.p.resident_name || pop.p.status_name }}</b>
			</div>
			<div class="pop-meta">{{ pop.p.date_from }} – {{ pop.p.date_to }} · {{ dayDiff(pop.p.date_from, pop.p.date_to) }} ноч. · {{ STAGE_LABEL[pop.p.stage] }}</div>
			<div v-if="pop.p.comment" class="pop-meta">{{ pop.p.comment }}</div>
			<div v-if="canEdit" class="pop-actions">
				<Button v-for="a in STAGE_ACTIONS[pop.p.stage] || []" :key="a.to" size="sm" :variant="a.variant || 'default'" :icon="a.icon" @click="quickStage(pop.p, a.to)">{{ a.label }}</Button>
				<Button size="sm" variant="ghost" icon="pencil" @click="openPlacement(pop.p); pop.show = false">Открыть</Button>
				<Button size="sm" variant="danger" icon="x" @click="cancelBooking(pop.p)">Отменить</Button>
			</div>
		</div>

		<PlacementModal v-if="placement" :bed="placement.bed" :existing="placement.existing" :date="placement.date" :date-to="placement.dateTo" @saved="onSaved" @close="placement = null" />
	</div>
</template>

<style scoped>
.legend {
	display: flex;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.leg {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.pat {
	width: 20px;
	height: 12px;
	border-radius: 3px;
	display: inline-block;
}
.pat-exp {
	background: repeating-linear-gradient(45deg, var(--color-brand) 0 3px, transparent 3px 6px);
	border: 1px solid var(--color-brand);
}
.pat-in {
	background: var(--color-brand);
}
.pat-blk {
	background: repeating-linear-gradient(45deg, var(--color-gray) 0 3px, transparent 3px 6px);
}

.rack-scroll {
	overflow: auto;
	max-height: calc(100vh - 210px);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	cursor: grab;
	user-select: none;
	position: relative;
}
.rack-scroll.grabbing {
	cursor: grabbing;
}
.rack-scroll.selecting {
	cursor: crosshair;
}
.rack-scroll.loading {
	opacity: 0.55;
}
.rack-grid {
	position: relative;
}

.ribbon-layer {
	position: absolute;
	z-index: 0;
	pointer-events: none;
}
.band {
	position: absolute;
	background: repeating-linear-gradient(45deg, rgba(150, 155, 170, 0.28) 0 6px, transparent 6px 12px);
	border: 1px dashed var(--color-gray);
	border-radius: var(--radius-sm);
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
}
.band-txt {
	font-size: 10px;
	color: var(--color-secondary);
	white-space: nowrap;
	padding: 0 4px;
}
.today-line {
	position: absolute;
	top: 0;
	width: 2px;
	background: var(--color-brand);
	opacity: 0.7;
}
.ribbon {
	position: absolute;
	background: var(--rc);
	border-radius: 3px;
	display: flex;
	align-items: center;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
	overflow: hidden;
}
.ribbon.rl {
	border-top-left-radius: 999px;
	border-bottom-left-radius: 999px;
}
.ribbon.rr {
	border-top-right-radius: 999px;
	border-bottom-right-radius: 999px;
}
.ribbon.st-expected {
	background: repeating-linear-gradient(45deg, var(--rc) 0 6px, color-mix(in srgb, var(--rc) 55%, #000) 6px 12px);
}
.ribbon.st-checked_out {
	opacity: 0.5;
}
.ribbon-txt {
	font-size: var(--font-size-xs);
	font-weight: 700;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;
	padding: 0 8px;
}
.sel {
	position: absolute;
	background: var(--color-brand-highlight);
	border: 2px dashed var(--color-brand);
	border-radius: var(--radius-sm);
	z-index: 5;
}

.rack {
	position: relative;
	z-index: 1;
	border-collapse: separate;
	border-spacing: 0;
	table-layout: fixed;
	font-size: var(--font-size-sm);
}
.rack th,
.rack td {
	border-right: 1px solid var(--color-divider);
	border-bottom: 1px solid var(--color-divider);
	box-sizing: border-box;
}
.rack tbody th,
.rack tbody td {
	height: var(--rack-row);
}
.corner {
	position: sticky;
	top: 0;
	left: 0;
	z-index: 30;
	background: var(--color-raised-bg);
	padding: 0 var(--gap-md);
	text-align: left;
	font-weight: 700;
	color: var(--color-contrast);
}
.mcell {
	position: sticky;
	top: 0;
	z-index: 22;
	height: 22px;
	background: var(--color-raised-bg);
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
	font-weight: 700;
	text-align: left;
	padding-left: 6px;
}
.dcell {
	position: sticky;
	top: 22px;
	z-index: 22;
	height: 34px;
	background: var(--color-raised-bg);
	text-align: center;
	color: var(--color-secondary);
	padding: 0;
}
.dcell .wd {
	display: block;
	font-size: 9px;
	line-height: 1;
}
.dcell .dd {
	display: block;
	font-weight: 700;
	color: var(--color-contrast);
	line-height: 1.2;
}
.dcell.weekend {
	color: var(--color-secondary);
	background: var(--color-bg);
}
.dcell.today {
	background: var(--color-brand-highlight);
}
.dcell.today .dd {
	color: var(--color-brand);
}
.free-row th {
	position: sticky;
	top: 56px;
	z-index: 22;
	height: 24px;
	background: var(--color-raised-bg);
}
.free-lbl {
	left: 0;
	z-index: 26 !important;
	text-align: right;
	padding-right: var(--gap-sm);
	font-size: 10px;
	color: var(--color-secondary);
	text-transform: uppercase;
}
.fcell {
	text-align: center;
	font-size: 10px;
	font-weight: 700;
	color: var(--color-secondary);
}
.fcell.weekend {
	background: var(--color-bg);
}
.fcell.low {
	color: var(--color-orange);
}
.fcell.zero {
	color: var(--color-red);
}
.numcell,
.bedcell {
	position: sticky;
	z-index: 15;
	background: var(--color-raised-bg);
	text-align: left;
	white-space: nowrap;
	padding: 0 var(--gap-sm);
	vertical-align: middle;
}
.numcell {
	left: 0;
	border-right: 1px solid var(--color-divider);
}
.numcell .num {
	font-weight: 700;
	color: var(--color-contrast);
}
.numcell .cls {
	font-size: 10px;
	color: var(--color-secondary);
}
.bedcell {
	left: var(--rack-num);
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.cell {
	background: transparent;
	padding: 0;
}
.cell.weekend {
	background: rgba(128, 128, 128, 0.06);
}
.cell.today {
	background: color-mix(in srgb, var(--color-brand) 8%, transparent);
}

.pop {
	position: fixed;
	z-index: var(--z-popover);
	width: 260px;
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-floating);
	padding: var(--gap-md);
}
.pop.above {
	transform: translateY(-100%);
}
.pop-head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	margin-bottom: 4px;
}
.pop-meta {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.pop-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-xs);
	margin-top: var(--gap-sm);
}
</style>
