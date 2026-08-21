<script setup>
/**
 * Шахматка брони. Взаимодействие:
 *  - протяжка по свободным клеткам — новая бронь;
 *  - перетаскивание ленты — перенос на другое место/даты;
 *  - тяга за край ленты — продлить/сократить;
 *  - правый клик — меню действий; клавиатура — быстрые команды (клавиша ?).
 */
import { ref, onMounted, onUnmounted, computed, reactive, watch, nextTick } from "vue"
import { useRoute, useRouter } from "vue-router"
import { api, post, put } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"
import Icon from "@/components/Icon.vue"
import Modal from "@/components/Modal.vue"
import { PageHeader, Select, Input, Button, StatusDot, confirm } from "@/ui"

const COL = 40
const ROW = 34
const NUM = 104
const BED = 64
const LEFT = NUM + BED
const HEAD = 80
const EDGE = 7 // зона захвата края ленты, px

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
const search = ref("")
const searchEl = ref(null)
const showHelp = ref(false)

const data = ref({ rooms: [], placements: [], blocks: [] })
const loading = ref(false)
const placement = ref(null)
const busy = ref(false)

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

const rooms = computed(() => (classFilter.value ? data.value.rooms.filter((r) => r.class_name === classFilter.value) : data.value.rooms))
const classOptions = computed(() => [...new Set(data.value.rooms.map((r) => r.class_name).filter(Boolean))])

const flatBeds = computed(() => {
	const out = []
	for (const room of rooms.value) {
		const beds = room.beds || []
		beds.forEach((bed, i) => out.push({ room, bed, rowIndex: out.length, first: i === 0, rowspan: beds.length }))
	}
	return out
})
const bedRow = computed(() => new Map(flatBeds.value.map((f) => [f.bed.id, f.rowIndex])))

function contrastText(hex) {
	const h = (hex || "").replace("#", "")
	if (h.length < 6) return "#0c0c0c"
	const r = parseInt(h.slice(0, 2), 16)
	const g = parseInt(h.slice(2, 4), 16)
	const b = parseInt(h.slice(4, 6), 16)
	return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0c0c0c" : "#ffffff"
}
const matchesSearch = (p) => {
	const q = search.value.trim().toLowerCase()
	return q ? (p.resident_name || "").toLowerCase().includes(q) : false
}

/* ---------- раскладка ---------- */
const layout = computed(() => {
	const s = span.value
	const bedRowMap = bedRow.value
	const validBeds = new Set(flatBeds.value.map((f) => f.bed.id))
	const roomFirstRow = new Map()
	for (const f of flatBeds.value) if (f.first) roomFirstRow.set(f.room.id, { top: f.rowIndex, height: f.rowspan })

	const occ = new Map()
	const blk = new Map()
	const cellPl = new Map()
	const ribbons = []
	const bands = []

	for (const p of data.value.placements) {
		if (p.stage === "cancelled" || !validBeds.has(p.bed_id)) continue
		if (drag.id === p.id && ghost.active) continue // оригинал прячем, пока тянем
		pushRibbon(p, p.bed_id, p.date_from, p.date_to)
	}

	function pushRibbon(p, bedId, dFrom, dTo, isGhost = false) {
		const startOff = dayDiff(from.value, dFrom)
		const endOff = dayDiff(from.value, dTo)
		const leftPx = startOff >= 0 ? (startOff + 0.5) * COL : 0
		const rightPx = endOff <= s - 1 ? (endOff + 0.5) * COL : s * COL
		ribbons.push({
			id: p.id,
			p,
			ghost: isGhost,
			row: bedRowMap.get(bedId),
			leftPx,
			width: Math.max(rightPx - leftPx, COL * 0.5),
			roundL: startOff >= 0,
			roundR: endOff <= s - 1,
			color: p.status_color,
			text: contrastText(p.status_color),
			label: p.resident_name || p.status_name,
			stage: p.stage,
			nights: dayDiff(dFrom, dTo),
			hit: matchesSearch(p),
		})
		if (isGhost) return
		const c0 = Math.max(0, startOff)
		const c1 = Math.min(s - 1, endOff - 1)
		if (!occ.has(bedId)) occ.set(bedId, new Set())
		if (!cellPl.has(bedId)) cellPl.set(bedId, new Map())
		for (let c = c0; c <= c1; c++) {
			occ.get(bedId).add(c)
			cellPl.get(bedId).set(c, p)
		}
	}

	// Призрак перетаскиваемой ленты
	if (ghost.active && ghost.p) pushRibbon(ghost.p, ghost.bedId, ghost.from, ghost.to, true)

	for (const b of data.value.blocks) {
		const fr = roomFirstRow.get(b.room_id)
		if (!fr) continue
		const c0 = Math.max(0, dayDiff(from.value, b.date_from))
		const c1 = Math.min(s - 1, dayDiff(from.value, b.date_to))
		if (c1 < c0) continue
		bands.push({ id: b.id, top: fr.top * ROW, height: fr.height * ROW, leftPx: c0 * COL, width: (c1 - c0 + 1) * COL, reason: b.reason })
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
	return {
		ribbons,
		bands,
		occ,
		blk,
		cellPl,
		freePerDay,
		totalBeds,
		todayX: todayOff >= 0 && todayOff < s ? (todayOff + 0.5) * COL : null,
		height: totalBeds * ROW,
	}
})
const lowThresh = computed(() => Math.max(1, Math.round(layout.value.totalBeds * 0.2)))
const searchHits = computed(() => (search.value.trim() ? layout.value.ribbons.filter((r) => r.hit).length : 0))

/* ---------- данные ---------- */
async function load() {
	if (!hotelId.value) return
	loading.value = true
	try {
		data.value = await api(`/rack?hotel_id=${hotelId.value}&from=${from.value}&to=${days.value[days.value.length - 1]}`)
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
	window.addEventListener("pointermove", onMove)
	window.addEventListener("pointerup", onUp)
	window.addEventListener("keydown", onKey)
})
onUnmounted(() => {
	window.removeEventListener("pointermove", onMove)
	window.removeEventListener("pointerup", onUp)
	window.removeEventListener("keydown", onKey)
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

/* ---------- координаты и взаимодействие ---------- */
const scrollEl = ref(null)
const mode = ref(null) // pan | select | move | resize-l | resize-r
let panStart = null
let moved = false
const sel = reactive({ active: false, bedId: null, row: 0, a: 0, b: 0 })
const drag = reactive({ id: null, p: null, grabCol: 0, kind: null })
const ghost = reactive({ active: false, p: null, bedId: null, from: "", to: "", ok: true })
const menu = reactive({ show: false, p: null, x: 0, y: 0 })
const selectedId = ref(null)

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
	return {
		region: "grid",
		col,
		row,
		f,
		gx: x - LEFT,
		placement: layout.value.cellPl.get(f.bed.id)?.get(col) || null,
		blocked: layout.value.blk.get(f.bed.id)?.has(col) || false,
	}
}

// Где именно на ленте курсор: край (resize) или середина (move)
function ribbonZone(p, gx) {
	const l = (dayDiff(from.value, p.date_from) + 0.5) * COL
	const r = (dayDiff(from.value, p.date_to) + 0.5) * COL
	if (gx - l <= EDGE) return "resize-l"
	if (r - gx <= EDGE) return "resize-r"
	return "move"
}

function onDown(e) {
	if (e.button === 2) return
	const loc = locate(e.clientX, e.clientY)
	moved = false
	menu.show = false
	hidePopover(true)
	if (e.button === 1 || !loc || loc.region !== "grid") return startPan(e)

	if (loc.placement) {
		selectedId.value = loc.placement.id
		if (!canEdit) return startPan(e)
		const zone = ribbonZone(loc.placement, loc.gx)
		drag.id = loc.placement.id
		drag.p = loc.placement
		drag.kind = zone
		drag.grabCol = loc.col - dayDiff(from.value, loc.placement.date_from)
		mode.value = zone
		e.preventDefault()
		return
	}
	if (canEdit && !loc.blocked) {
		mode.value = "select"
		Object.assign(sel, { active: true, bedId: loc.f.bed.id, row: loc.row, a: loc.col, b: loc.col })
		e.preventDefault()
		return
	}
	startPan(e)
}
function startPan(e) {
	mode.value = "pan"
	panStart = { x: e.clientX, y: e.clientY, left: scrollEl.value.scrollLeft, top: scrollEl.value.scrollTop }
}

// Свободен ли отрезок на месте (без учёта самой перетаскиваемой брони)
function rangeFree(bedId, dFrom, dTo, ignoreId) {
	for (const p of data.value.placements) {
		if (p.id === ignoreId || p.stage === "cancelled" || p.bed_id !== bedId) continue
		if (p.date_from < dTo && dFrom < p.date_to) return false
	}
	const f = flatBeds.value.find((x) => x.bed.id === bedId)
	for (const b of data.value.blocks) {
		if (f && b.room_id === f.room.id && b.date_from <= dTo && dFrom <= b.date_to) return false
	}
	return true
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
		const dir = loc.col >= sel.a ? 1 : -1
		let b = sel.a
		for (let c = sel.a + dir; dir > 0 ? c <= loc.col : c >= loc.col; c += dir) {
			if (layout.value.occ.get(sel.bedId)?.has(c) || layout.value.blk.get(sel.bedId)?.has(c)) break
			b = c
		}
		if (b !== sel.b) moved = true
		sel.b = b
		return
	}
	if (mode.value === "move" || mode.value === "resize-l" || mode.value === "resize-r") {
		const loc = locate(e.clientX, e.clientY)
		if (!loc || loc.region !== "grid") return
		const p = drag.p
		const nights = dayDiff(p.date_from, p.date_to)
		moved = true
		let bedId = p.bed_id
		let dFrom = p.date_from
		let dTo = p.date_to
		if (mode.value === "move") {
			bedId = loc.f.bed.id
			dFrom = days.value[Math.max(0, Math.min(span.value - 1, loc.col - drag.grabCol))] || from.value
			dTo = addDays(dFrom, nights)
		} else if (mode.value === "resize-l") {
			dFrom = days.value[loc.col] || p.date_from
			if (dayDiff(dFrom, dTo) < 1) dFrom = addDays(dTo, -1)
		} else {
			dTo = days.value[loc.col] ? addDays(days.value[loc.col], 1) : p.date_to
			if (dayDiff(dFrom, dTo) < 1) dTo = addDays(dFrom, 1)
		}
		Object.assign(ghost, { active: true, p, bedId, from: dFrom, to: dTo, ok: rangeFree(bedId, dFrom, dTo, p.id) })
		return
	}
	if (mode.value === null) hover(e)
}

async function onUp() {
	if (mode.value === "select" && sel.active) {
		const a = Math.min(sel.a, sel.b)
		const b = Math.max(sel.a, sel.b)
		const f = flatBeds.value[sel.row]
		if (f) placement.value = { bed: { id: f.bed.id, label: `${f.room.number} · ${f.bed.label}` }, existing: null, date: days.value[a], dateTo: addDays(days.value[b], 1) }
	} else if (ghost.active && moved) {
		await commitGhost()
	} else if (drag.p && !moved) {
		openPlacement(drag.p)
	}
	mode.value = null
	sel.active = false
	ghost.active = false
	drag.id = null
	drag.p = null
	setTimeout(() => (moved = false), 0)
}

async function commitGhost() {
	const p = ghost.p
	const { bedId, from: dFrom, to: dTo, ok } = ghost
	ghost.active = false
	if (!ok) return toast.error("Место занято или на ремонте")
	if (bedId === p.bed_id && dFrom === p.date_from && dTo === p.date_to) return
	busy.value = true
	try {
		await put(`/placements/${p.id}`, {
			bed_id: bedId,
			resident_id: p.resident_id,
			status_id: p.status_id,
			stage: p.stage,
			date_from: dFrom,
			date_to: dTo,
			comment: p.comment,
		})
		toast.success(bedId === p.bed_id ? "Даты изменены" : "Бронь перенесена")
		await load()
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}

function openPlacement(p) {
	const f = flatBeds.value.find((x) => x.bed.id === p.bed_id)
	placement.value = { bed: { id: p.bed_id, label: f ? `${f.room.number} · ${f.bed.label}` : "" }, existing: p, date: p.date_from }
}
function onSaved() {
	placement.value = null
	load()
}

/* ---------- контекстное меню ---------- */
function onContext(e) {
	const loc = locate(e.clientX, e.clientY)
	if (!canEdit || !loc || loc.region !== "grid" || !loc.placement) return
	e.preventDefault()
	selectedId.value = loc.placement.id
	Object.assign(menu, { show: true, p: loc.placement, x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 260) })
}

/* ---------- поповер ---------- */
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
	} else schedulePopHide()
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

/* ---------- действия ---------- */
const STAGE_ACTIONS = {
	expected: [{ to: "checked_in", label: "Заселить", icon: "check", variant: "primary" }],
	checked_in: [{ to: "checked_out", label: "Выселить", icon: "log-out" }],
	checked_out: [{ to: "checked_in", label: "Вернуть", icon: "rotate-cw" }],
}
const STAGE_LABEL = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал" }

async function quickStage(p, stage) {
	try {
		await post(`/placements/${p.id}/stage`, { stage })
		p.stage = stage
		menu.show = false
		toast.success(`Стадия: «${STAGE_LABEL[stage]}»`)
	} catch (e) {
		toast.error(e.message)
	}
}
async function cancelBooking(p) {
	menu.show = false
	if (!(await confirm({ title: "Отменить бронь?", message: `${p.resident_name || p.status_name}, ${p.date_from} – ${p.date_to}`, danger: true, confirmLabel: "Отменить" }))) return
	try {
		await put(`/placements/${p.id}`, { resident_id: p.resident_id, status_id: p.status_id, stage: "cancelled", date_from: p.date_from, date_to: p.date_to, comment: p.comment })
		pop.show = false
		load()
	} catch (e) {
		toast.error(e.message)
	}
}
function nudge(p, days) {
	Object.assign(ghost, { active: false })
	put(`/placements/${p.id}`, {
		bed_id: p.bed_id,
		resident_id: p.resident_id,
		status_id: p.status_id,
		stage: p.stage,
		date_from: addDays(p.date_from, days),
		date_to: addDays(p.date_to, days),
		comment: p.comment,
	})
		.then(() => {
			menu.show = false
			toast.success(days > 0 ? "Сдвинуто вперёд" : "Сдвинуто назад")
			load()
		})
		.catch((e) => toast.error(e.message))
}

/* ---------- клавиатура ---------- */
const selectedPlacement = computed(() => data.value.placements.find((p) => p.id === selectedId.value) || null)

function onKey(e) {
	const tag = (e.target?.tagName || "").toLowerCase()
	const typing = tag === "input" || tag === "textarea" || tag === "select"
	if (e.key === "Escape") {
		if (menu.show) return (menu.show = false)
		if (showHelp.value) return (showHelp.value = false)
		if (typing) return e.target.blur()
		selectedId.value = null
		return
	}
	if (typing) return
	const p = selectedPlacement.value
	switch (e.key) {
		case "ArrowRight":
			e.preventDefault()
			return shiftFrom(e.shiftKey ? 30 : 7)
		case "ArrowLeft":
			e.preventDefault()
			return shiftFrom(e.shiftKey ? -30 : -7)
		case "t":
		case "T":
		case "е":
		case "Е":
			return goToday()
		case "1":
			span.value = 7
			return load()
		case "2":
			span.value = 14
			return load()
		case "3":
			span.value = 30
			return load()
		case "4":
			span.value = 60
			return load()
		case "/":
		case "f":
		case "F":
			e.preventDefault()
			return searchEl.value?.focus?.()
		case "?":
			return (showHelp.value = true)
	}
	if (!p || !canEdit) return
	if (e.key === "Enter") return openPlacement(p)
	if (e.key === "Delete" || e.key === "Backspace") return cancelBooking(p)
	if (e.key === "e" || e.key === "E" || e.key === "у" || e.key === "У") return p.stage === "expected" && quickStage(p, "checked_in")
	if (e.key === "o" || e.key === "O" || e.key === "щ" || e.key === "Щ") return p.stage === "checked_in" && quickStage(p, "checked_out")
	if (e.key === "[") return nudge(p, -1)
	if (e.key === "]") return nudge(p, 1)
}

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
		<PageHeader title="Бронирование" subtitle="Протяжка — новая бронь · лента — перенос и края · правый клик — меню · «?» — клавиши" icon="calendar">
			<template #actions>
				<Button icon="info" @click="showHelp = true">Клавиши</Button>
			</template>
		</PageHeader>

		<div class="toolbar">
			<Select v-model="hotelId" style="width: auto" @change="load">
				<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
			</Select>
			<Input v-model="from" type="date" style="width: auto" @change="load" />
			<div class="segs">
				<button v-for="s in [7, 14, 30, 60]" :key="s" type="button" class="seg" :class="{ on: span === s }" @click="span = s; load()">{{ s }}д</button>
			</div>
			<Select v-model="classFilter" style="width: auto">
				<option value="">Все типы</option>
				<option v-for="c in classOptions" :key="c" :value="c">{{ c }}</option>
			</Select>
			<div class="nav">
				<Button size="sm" icon="chevron-left" @click="shiftFrom(-7)" />
				<Button size="sm" @click="goToday">Сегодня</Button>
				<Button size="sm" icon="chevron-right" @click="shiftFrom(7)" />
			</div>
			<div class="search-wrap">
				<Input ref="searchEl" v-model="search" placeholder="Найти проживающего (F)" />
				<span v-if="search.trim()" class="hits" :class="{ none: !searchHits }">{{ searchHits }}</span>
			</div>
		</div>

		<div class="legend">
			<span v-for="s in statuses" :key="s.id" class="leg"><StatusDot :color="s.color" /> {{ s.name }}</span>
			<span class="leg"><i class="sw sw-repair" /> ремонт</span>
			<span class="leg"><i class="sw sw-exp" /> ожидается</span>
		</div>

		<div ref="scrollEl" class="rack" :class="{ busy }" @pointerdown="onDown" @contextmenu="onContext" @pointerleave="schedulePopHide">
			<div class="rack-inner" :style="gridStyle">
				<!-- шапка -->
				<div class="head">
					<div class="corner"><span>Номер · место</span></div>
					<div class="months">
						<div v-for="m in monthSpans" :key="m.key" class="month" :style="{ width: m.colspan * COL + 'px' }">{{ m.label }}</div>
					</div>
					<div class="daysrow">
						<div v-for="d in dayInfo" :key="d.date" class="day" :class="{ we: d.weekend, today: d.today }" :title="fullDate(d.date)">
							<span class="wd">{{ d.wd }}</span><span class="dn">{{ d.num }}</span>
						</div>
					</div>
					<div class="freerow">
						<div class="freelabel">свободно</div>
						<div
							v-for="(f, i) in layout.freePerDay"
							:key="i"
							class="free"
							:class="{ low: f > 0 && f <= lowThresh, zero: f === 0 }"
						>{{ f }}</div>
					</div>
				</div>

				<!-- тело -->
				<div class="body" :style="{ height: layout.height + 'px' }">
					<div class="rowlabels">
						<div v-for="f in flatBeds" :key="f.bed.id" class="rowlabel" :style="{ top: f.rowIndex * ROW + 'px' }">
							<div class="num" :class="{ first: f.first }">
								<template v-if="f.first"><b>№ {{ f.room.number }}</b><span class="cls">{{ f.room.class_name || "—" }}</span></template>
							</div>
							<div class="bedname">{{ f.bed.label }}</div>
						</div>
					</div>

					<div class="canvas" :style="{ width: span * COL + 'px', height: layout.height + 'px' }">
						<div v-for="(d, i) in dayInfo" :key="d.date" class="colline" :class="{ we: d.weekend }" :style="{ left: i * COL + 'px' }" />
						<div v-for="f in flatBeds" :key="'r' + f.bed.id" class="rowline" :style="{ top: (f.rowIndex + 1) * ROW + 'px' }" />
						<div v-if="layout.todayX != null" class="todayline" :style="{ left: layout.todayX + 'px' }" />

						<div v-for="b in layout.bands" :key="'b' + b.id" class="band" :style="{ top: b.top + 'px', left: b.leftPx + 'px', width: b.width + 'px', height: b.height + 'px' }" :title="b.reason || 'Ремонт'" />

						<div
							v-for="r in layout.ribbons"
							:key="'p' + r.id + (r.ghost ? 'g' : '')"
							class="ribbon"
							:class="{
								roundL: r.roundL,
								roundR: r.roundR,
								exp: r.stage === 'expected',
								out: r.stage === 'checked_out',
								ghost: r.ghost,
								bad: r.ghost && !ghost.ok,
								hit: r.hit,
								sel: !r.ghost && r.id === selectedId,
							}"
							:style="{ top: r.row * ROW + 3 + 'px', left: r.leftPx + 'px', width: r.width + 'px', height: ROW - 6 + 'px', '--rc': r.color, color: r.text }"
						>
							<span class="rlabel">{{ r.label }}</span>
							<i v-if="!r.ghost && canEdit" class="grip grip-l" />
							<i v-if="!r.ghost && canEdit" class="grip grip-r" />
						</div>

						<div v-if="selStyle" class="selbox" :style="selStyle" />
					</div>
				</div>
			</div>
		</div>

		<!-- поповер -->
		<div v-if="pop.show && pop.p" class="pop" :class="{ above: pop.above }" :style="{ left: pop.x + 'px', top: pop.y + 'px' }" @pointerenter="keepPopover" @pointerleave="schedulePopHide">
			<div class="row" style="gap: var(--gap-sm)">
				<StatusDot :color="pop.p.status_color" size="12px" />
				<b class="contrast">{{ pop.p.resident_name || pop.p.status_name }}</b>
			</div>
			<div class="muted pop-sub">{{ pop.p.date_from }} – {{ pop.p.date_to }} · {{ STAGE_LABEL[pop.p.stage] || pop.p.status_name }}</div>
			<p v-if="pop.p.comment" class="pop-note">{{ pop.p.comment }}</p>
			<div v-if="canEdit" class="pop-acts">
				<Button v-for="a in STAGE_ACTIONS[pop.p.stage] || []" :key="a.to" size="sm" :variant="a.variant" :icon="a.icon" @click="quickStage(pop.p, a.to)">{{ a.label }}</Button>
				<Button size="sm" icon="pencil" @click="openPlacement(pop.p)">Открыть</Button>
			</div>
		</div>

		<!-- контекстное меню -->
		<div v-if="menu.show && menu.p" class="ctx" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
			<div class="ctx-head">{{ menu.p.resident_name || menu.p.status_name }}</div>
			<button v-for="a in STAGE_ACTIONS[menu.p.stage] || []" :key="a.to" class="ctx-item" @click="quickStage(menu.p, a.to)">
				<Icon :name="a.icon" size="0.9rem" /> {{ a.label }}
			</button>
			<button class="ctx-item" @click="openPlacement(menu.p); menu.show = false"><Icon name="pencil" size="0.9rem" /> Открыть карточку <kbd>Enter</kbd></button>
			<button class="ctx-item" @click="nudge(menu.p, -1)"><Icon name="chevron-left" size="0.9rem" /> На день назад <kbd>[</kbd></button>
			<button class="ctx-item" @click="nudge(menu.p, 1)"><Icon name="chevron-right" size="0.9rem" /> На день вперёд <kbd>]</kbd></button>
			<div class="ctx-sep" />
			<button class="ctx-item danger" @click="cancelBooking(menu.p)"><Icon name="trash" size="0.9rem" /> Отменить бронь <kbd>Del</kbd></button>
		</div>
		<div v-if="menu.show" class="ctx-catch" @pointerdown="menu.show = false" @contextmenu.prevent="menu.show = false" />

		<Modal v-if="showHelp" title="Горячие клавиши и жесты" @close="showHelp = false">
			<div class="keys">
				<div class="kgroup">
					<h4>Навигация</h4>
					<div class="krow"><kbd>←</kbd><kbd>→</kbd><span>неделя назад / вперёд</span></div>
					<div class="krow"><kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd><span>месяц</span></div>
					<div class="krow"><kbd>T</kbd><span>к сегодняшнему дню</span></div>
					<div class="krow"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>период 7 / 14 / 30 / 60 дней</span></div>
					<div class="krow"><kbd>F</kbd><span>поиск проживающего</span></div>
				</div>
				<div class="kgroup">
					<h4>Бронь (выберите ленту кликом)</h4>
					<div class="krow"><kbd>Enter</kbd><span>открыть карточку</span></div>
					<div class="krow"><kbd>E</kbd><span>заселить</span></div>
					<div class="krow"><kbd>O</kbd><span>выселить</span></div>
					<div class="krow"><kbd>[</kbd><kbd>]</kbd><span>сдвинуть на день</span></div>
					<div class="krow"><kbd>Del</kbd><span>отменить бронь</span></div>
					<div class="krow"><kbd>Esc</kbd><span>снять выделение</span></div>
				</div>
				<div class="kgroup">
					<h4>Мышь</h4>
					<div class="krow"><span class="gesture">Протяжка по пустым клеткам</span><span>новая бронь</span></div>
					<div class="krow"><span class="gesture">Тянуть ленту</span><span>перенос на другое место и даты</span></div>
					<div class="krow"><span class="gesture">Тянуть за край ленты</span><span>продлить / сократить</span></div>
					<div class="krow"><span class="gesture">Правый клик</span><span>меню действий</span></div>
					<div class="krow"><span class="gesture">Тянуть фон / средняя кнопка</span><span>прокрутка</span></div>
				</div>
			</div>
		</Modal>

		<PlacementModal v-if="placement" v-bind="placement" @close="placement = null" @saved="onSaved" />
	</div>
</template>

<style scoped>
.toolbar {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.segs {
	display: inline-flex;
	gap: 2px;
	padding: 3px;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.seg {
	padding: 4px var(--gap-sm);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: 700;
	cursor: pointer;
	color: var(--color-secondary);
	background: transparent;
	border: none;
	border-radius: var(--radius-sm);
}
.seg.on {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.nav {
	display: inline-flex;
	gap: var(--gap-xs);
}
.search-wrap {
	position: relative;
	flex: 1;
	min-width: 180px;
}
.hits {
	position: absolute;
	right: 10px;
	top: 50%;
	transform: translateY(-50%);
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-brand);
	pointer-events: none;
}
.hits.none {
	color: var(--color-secondary);
}
.legend {
	display: flex;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.leg {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.sw {
	width: 14px;
	height: 10px;
	border-radius: 3px;
	display: inline-block;
}
.sw-repair {
	background: repeating-linear-gradient(45deg, var(--color-orange) 0 3px, transparent 3px 6px);
	border: 1px solid var(--color-orange);
}
.sw-exp {
	background: repeating-linear-gradient(45deg, var(--color-brand) 0 3px, transparent 3px 6px);
	border: 1px solid var(--color-brand);
}

.rack {
	position: relative;
	overflow: auto;
	max-height: 68vh;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	cursor: default;
	user-select: none;
	touch-action: none;
}
.rack.busy {
	opacity: 0.7;
	pointer-events: none;
}
.rack-inner {
	position: relative;
}
.head {
	position: sticky;
	top: 0;
	z-index: 4;
	background: var(--color-raised-bg);
	border-bottom: 1px solid var(--color-divider);
	height: 80px;
}
.corner {
	position: absolute;
	left: 0;
	top: 0;
	width: calc(var(--rack-num) + var(--rack-bed));
	height: 80px;
	display: flex;
	align-items: flex-end;
	padding: var(--gap-sm);
	background: var(--color-raised-bg);
	border-right: 1px solid var(--color-divider);
	z-index: 2;
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-secondary);
}
.months,
.daysrow,
.freerow {
	position: absolute;
	left: calc(var(--rack-num) + var(--rack-bed));
	display: flex;
}
.months {
	top: 0;
	height: 20px;
}
.month {
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-secondary);
	padding-left: 6px;
	border-left: 1px solid var(--color-divider);
	line-height: 20px;
	white-space: nowrap;
	overflow: hidden;
}
.daysrow {
	top: 20px;
	height: 38px;
}
.day {
	width: var(--rack-col);
	display: grid;
	place-items: center;
	gap: 0;
	font-size: 10px;
	color: var(--color-secondary);
}
.day.we {
	background: color-mix(in srgb, var(--color-orange), transparent 92%);
}
.day.today {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: 800;
}
.day .dn {
	font-size: 12px;
	font-weight: 700;
	color: var(--color-contrast);
}
.day.today .dn {
	color: var(--color-brand);
}
.freerow {
	top: 58px;
	height: 22px;
}
.freelabel {
	position: absolute;
	left: calc(-1 * (var(--rack-num) + var(--rack-bed)) + 8px);
	font-size: 10px;
	color: var(--color-secondary);
	line-height: 22px;
}
.free {
	width: var(--rack-col);
	text-align: center;
	font-size: 11px;
	font-weight: 700;
	color: var(--color-secondary);
	line-height: 22px;
}
.free.low {
	color: var(--color-orange);
}
.free.zero {
	color: var(--color-red);
}

.body {
	position: relative;
}
.rowlabels {
	position: sticky;
	left: 0;
	z-index: 3;
	width: calc(var(--rack-num) + var(--rack-bed));
	float: left;
	height: 100%;
	background: var(--color-raised-bg);
	border-right: 1px solid var(--color-divider);
}
.rowlabel {
	position: absolute;
	left: 0;
	display: flex;
	width: 100%;
	height: var(--rack-row);
	align-items: center;
	border-bottom: 1px solid var(--color-divider);
}
.num {
	width: var(--rack-num);
	padding: 0 var(--gap-sm);
	display: flex;
	flex-direction: column;
	justify-content: center;
	line-height: 1.15;
	overflow: hidden;
}
.num b {
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.cls {
	font-size: 10px;
	color: var(--color-secondary);
	white-space: nowrap;
}
.bedname {
	width: var(--rack-bed);
	font-size: 11px;
	color: var(--color-secondary);
	padding-left: var(--gap-xs);
}
.canvas {
	position: relative;
	margin-left: calc(var(--rack-num) + var(--rack-bed));
}
.colline {
	position: absolute;
	top: 0;
	bottom: 0;
	width: var(--rack-col);
	border-right: 1px solid var(--color-divider);
}
.colline.we {
	background: color-mix(in srgb, var(--color-orange), transparent 96%);
}
.rowline {
	position: absolute;
	left: 0;
	right: 0;
	border-bottom: 1px solid var(--color-divider);
}
.todayline {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 2px;
	background: var(--color-brand);
	z-index: 2;
}
.band {
	position: absolute;
	background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-orange), transparent 70%) 0 5px, transparent 5px 10px);
	border: 1px solid var(--color-orange);
	border-radius: var(--radius-sm);
	z-index: 1;
}
.ribbon {
	position: absolute;
	z-index: 2;
	display: flex;
	align-items: center;
	padding: 0 8px;
	background: var(--rc);
	border-radius: 3px;
	font-size: 11px;
	font-weight: 700;
	white-space: nowrap;
	overflow: hidden;
	cursor: grab;
}
.ribbon.roundL {
	border-top-left-radius: 999px;
	border-bottom-left-radius: 999px;
}
.ribbon.roundR {
	border-top-right-radius: 999px;
	border-bottom-right-radius: 999px;
}
.ribbon.exp {
	background: repeating-linear-gradient(45deg, var(--rc) 0 6px, color-mix(in srgb, var(--rc) 55%, #000) 6px 12px);
}
.ribbon.out {
	opacity: 0.55;
}
.ribbon.sel {
	outline: 2px solid var(--color-contrast);
	outline-offset: 1px;
	z-index: 3;
}
.ribbon.hit {
	outline: 2px solid var(--color-brand);
	outline-offset: 1px;
	z-index: 3;
}
.ribbon.ghost {
	opacity: 0.75;
	z-index: 5;
	outline: 2px dashed var(--color-contrast);
	pointer-events: none;
}
.ribbon.bad {
	background: var(--color-red) !important;
	outline-color: var(--color-red);
}
.rlabel {
	overflow: hidden;
	text-overflow: ellipsis;
}
.grip {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 7px;
	cursor: ew-resize;
}
.grip-l {
	left: 0;
}
.grip-r {
	right: 0;
}
.selbox {
	position: absolute;
	z-index: 4;
	background: var(--color-brand-highlight);
	border: 2px dashed var(--color-brand);
	border-radius: 3px;
	pointer-events: none;
}

/* поповер и меню */
.pop {
	position: fixed;
	z-index: 60;
	width: 264px;
	padding: var(--gap-md);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-floating, 0 8px 24px rgba(0, 0, 0, 0.4));
}
.pop.above {
	transform: translateY(-100%);
}
.pop-sub {
	font-size: var(--font-size-xs);
	margin-top: 4px;
}
.pop-note {
	margin: var(--gap-xs) 0 0;
	font-size: var(--font-size-xs);
	white-space: pre-wrap;
}
.pop-acts {
	display: flex;
	gap: var(--gap-xs);
	flex-wrap: wrap;
	margin-top: var(--gap-sm);
}
.ctx {
	position: fixed;
	z-index: 70;
	min-width: 210px;
	padding: 4px;
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-floating, 0 8px 24px rgba(0, 0, 0, 0.4));
}
.ctx-catch {
	position: fixed;
	inset: 0;
	z-index: 69;
}
.ctx-head {
	padding: var(--gap-xs) var(--gap-sm);
	font-size: var(--font-size-xs);
	font-weight: 800;
	color: var(--color-contrast);
	border-bottom: 1px solid var(--color-divider);
	margin-bottom: 4px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ctx-item {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	width: 100%;
	padding: var(--gap-xs) var(--gap-sm);
	font: inherit;
	font-size: var(--font-size-sm);
	text-align: left;
	cursor: pointer;
	color: var(--color-base);
	background: transparent;
	border: none;
	border-radius: var(--radius-sm);
}
.ctx-item:hover {
	background: var(--color-button-bg);
}
.ctx-item.danger {
	color: var(--color-red);
}
.ctx-item kbd {
	margin-left: auto;
}
.ctx-sep {
	height: 1px;
	background: var(--color-divider);
	margin: 4px 0;
}
kbd {
	display: inline-block;
	min-width: 18px;
	padding: 1px 5px;
	font: inherit;
	font-size: 10px;
	font-weight: 700;
	text-align: center;
	color: var(--color-secondary);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: 4px;
}
.keys {
	display: grid;
	gap: var(--gap-lg);
}
.kgroup h4 {
	margin: 0 0 var(--gap-sm);
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
}
.krow {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 3px 0;
	font-size: var(--font-size-sm);
}
.krow span:last-child {
	margin-left: auto;
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
	text-align: right;
}
.gesture {
	font-weight: 600;
	color: var(--color-base);
	font-size: var(--font-size-xs);
}
</style>
