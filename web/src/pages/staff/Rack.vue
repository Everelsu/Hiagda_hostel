<script setup>
/**
 * Календарь броней: строки — спальные места, столбцы — дни, лента — одна бронь.
 * Взаимодействие:
 *  - протяжка по свободным клеткам — новая бронь;
 *  - перетаскивание ленты — перенос на другое место/даты;
 *  - тяга за край ленты — продлить/сократить;
 *  - правый клик — меню действий; клавиатура — быстрые команды (клавиша ?).
 */
import { ref, onMounted, onUnmounted, computed, reactive, watch, nextTick } from "vue"
import { useRoute, useRouter } from "vue-router"
import { onRealtime } from "@/realtime"
import { api, post, put, del } from "@/api/client"
import { nightsWord, dm } from "@/utils/date"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"
import Icon from "@/components/Icon.vue"
import Modal from "@/components/Modal.vue"
import { Select, Input, Button, IconButton, SegmentedControl, StatusDot, confirm, DateInput } from "@/ui"

// Ширина дня подстраивается под экран (чтобы 7–30 дней не оставляли пустоту справа),
// высота строки — плотность: «компактно» помещает вдвое больше мест на экран.
const colW = ref(40)
const rowH = ref(34)
const NUM = 104
const BED = 64
const LEFT = NUM + BED
const HEAD = 80
const EDGE = 7 // зона захвата края ленты, px

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const canEdit = auth.can("editor")
const canRepair = auth.canRepair // ремонтник ставит и снимает ремонт, но не бронирует

const hotels = ref([])
const statuses = ref([])
const hotelId = ref(null)
const from = ref(route.query.from || ymd(new Date()))
const span = ref(Number(route.query.span) || 30)
const classFilter = ref("")
const search = ref("")
const searchEl = ref(null)
const showHelp = ref(false)
const SPANS = [7, 14, 30, 60].map((n) => ({ value: n, label: n + " дн." }))

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

// Свободно/Ремонт — производные состояния: в легенде и на полосах, но не в брони
const bookingStatuses = computed(() => statuses.value.filter((s) => s.kind !== "system"))
const systemStatus = (code) => statuses.value.find((s) => s.code === code)
const repairColor = computed(() => systemStatus("repair")?.color || "var(--color-orange)")
const repairName = computed(() => systemStatus("repair")?.name || "Ремонт")

// В доме на сотни мест нужны фильтры: этаж и «только номера со свободными местами»
const floorFilter = ref("")
const onlyFree = ref(false)
const floorOptions = computed(() => [...new Set(data.value.rooms.map((r) => r.floor ?? 1))].sort((a, b) => a - b))
// Сколько ночей периода занято у каждого места (брони + ремонт номера)
const busyNights = computed(() => {
	const m = new Map()
	const last = days.value[days.value.length - 1]
	const add = (bedId, a, b) => m.set(bedId, (m.get(bedId) || 0) + Math.max(0, dayDiff(a, b)))
	for (const p of data.value.placements) {
		if (p.stage === "cancelled") continue
		add(p.bed_id, p.date_from > from.value ? p.date_from : from.value, p.date_to < addDays(last, 1) ? p.date_to : addDays(last, 1))
	}
	for (const b of data.value.blocks) {
		const room = data.value.rooms.find((r) => r.id === b.room_id)
		const end = addDays(b.date_to, 1)
		for (const bed of room?.beds || []) add(bed.id, b.date_from > from.value ? b.date_from : from.value, end < addDays(last, 1) ? end : addDays(last, 1))
	}
	return m
})
const roomHasFree = (room) => (room.beds || []).some((b) => (busyNights.value.get(b.id) || 0) < span.value)
const rooms = computed(() =>
	data.value.rooms.filter(
		(r) =>
			(!classFilter.value || r.class_name === classFilter.value) &&
			(floorFilter.value === "" || String(r.floor ?? 1) === String(floorFilter.value)) &&
			(!onlyFree.value || roomHasFree(r)),
	),
)
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
		const leftPx = startOff >= 0 ? (startOff + 0.5) * colW.value : 0
		const rightPx = endOff <= s - 1 ? (endOff + 0.5) * colW.value : s * colW.value
		ribbons.push({
			id: p.id,
			p,
			ghost: isGhost,
			row: bedRowMap.get(bedId),
			leftPx,
			width: Math.max(rightPx - leftPx, colW.value * 0.5),
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
		bands.push({ id: b.id, top: fr.top * rowH.value, height: fr.height * rowH.value, leftPx: c0 * colW.value, width: (c1 - c0 + 1) * colW.value, reason: b.reason })
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
		todayX: todayOff >= 0 && todayOff < s ? (todayOff + 0.5) * colW.value : null,
		height: totalBeds * rowH.value,
	}
})
const lowThresh = computed(() => Math.max(1, Math.round(layout.value.totalBeds * 0.2)))
const searchHits = computed(() => (search.value.trim() ? layout.value.ribbons.filter((r) => r.hit).length : 0))
// Enter в поиске — к следующему найденному (Shift+Enter — к предыдущему):
// среди сотен строк подсветка без прокрутки бесполезна
const hitIdx = ref(-1)
const hitList = computed(() => layout.value.ribbons.filter((r) => r.hit && !r.ghost).sort((a, b) => a.row - b.row || a.leftPx - b.leftPx))
watch(search, () => (hitIdx.value = -1))
function jumpHit(dir) {
	const list = hitList.value
	if (!list.length) return
	hitIdx.value = (hitIdx.value + dir + list.length) % list.length
	const r = list[hitIdx.value]
	selectedId.value = r.id
	const el = scrollEl.value
	el?.scrollTo({ top: Math.max(0, r.row * rowH.value - el.clientHeight / 2 + HEAD), left: Math.max(0, r.leftPx - 120), behavior: "smooth" })
}

// ── плотность и подгонка ширины дня под экран ──
const dense = ref(false)
try {
	dense.value = localStorage.getItem("rack_dense") === "1"
} catch {}
watch(
	dense,
	(v) => {
		rowH.value = v ? 24 : 34
		try {
			localStorage.setItem("rack_dense", v ? "1" : "0")
		} catch {}
	},
	{ immediate: true },
)
function fit() {
	const el = scrollEl.value
	if (!el) return
	colW.value = Math.max(24, Math.min(72, Math.floor((el.clientWidth - LEFT - 2) / span.value)))
}
watch(span, () => nextTick(fit))
let resizeObs = null
const hoverRow = ref(-1)

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
	resizeObs = new ResizeObserver(fit)
	if (scrollEl.value) resizeObs.observe(scrollEl.value)
	fit()
})
const stopRealtime = onRealtime((event) => {
	if (event.type !== "rack:changed" || Number(event.hotelId) !== Number(hotelId.value)) return
	// Do not replace the grid while the operator is dragging a booking.
	if (mode.value || busy.value) return
	load().catch((e) => toast.error(e.message))
})
onUnmounted(() => {
	window.removeEventListener("pointermove", onMove)
	window.removeEventListener("pointerup", onUp)
	window.removeEventListener("keydown", onKey)
	resizeObs?.disconnect()
	stopRealtime()
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
const drag = reactive({ id: null, p: null, startCol: 0, kind: null, x0: 0, y0: 0 })
const ghost = reactive({ active: false, p: null, bedId: null, from: "", to: "", ok: true, x: 0, y: 0 })
// Защита от случайного переноса (как в Noctrinth): перетаскивание начинается только
// после сдвига мыши на DRAG_THRESHOLD px, а результат подтверждается отдельно.
const DRAG_THRESHOLD = 6
const confirmMove = reactive({ show: false, x: 0, y: 0 })
let lastMove = null // для «Отменить» / Ctrl+Z
const menu = reactive({ show: false, p: null, x: 0, y: 0 })
const selectedId = ref(null)
// Выбор действия после протяжки по свободным клеткам
const pick = reactive({ show: false, f: null, from: "", to: "" })
const repairForm = reactive({ show: false, reason: "" })

// Выделение — это ночи: с pick.from по pick.to включительно, значит выезд на день позже.
const pickNights = computed(() => (pick.from && pick.to ? dayDiff(pick.from, pick.to) + 1 : 0))
const pickStayText = computed(() => `Заезд ${dm(pick.from)}, выезд ${dm(addDays(pick.to, 1))} — ${pickNights.value} ${nightsWord(pickNights.value)}`)
const pickRepairText = computed(() => `Ремонт с ${dm(pick.from)} по ${dm(pick.to)} включительно — ${pickNights.value} ${nightsWord(pickNights.value)}`)
// Подпись к брони: заезд, выезд и сколько ночей между ними
function stayText(p) {
	const n = dayDiff(p.date_from, p.date_to)
	return `${dm(p.date_from)} → ${dm(p.date_to)} · ${n} ${nightsWord(n)}`
}

function pickBooking() {
	pick.show = false
	placement.value = {
		bed: { id: pick.f.bed.id, label: `Номер № ${pick.f.room.number} · ${pick.f.bed.label}` },
		existing: null,
		date: pick.from,
		dateTo: addDays(pick.to, 1),
	}
}
function pickRepair() {
	pick.show = false
	repairForm.show = true
	repairForm.reason = ""
}
async function submitRepair() {
	busy.value = true
	try {
		await post(`/rooms/${pick.f.room.id}/blocks`, { date_from: pick.from, date_to: pick.to, reason: repairForm.reason || null })
		repairForm.show = false
		toast.success(`Номер № ${pick.f.room.number} на ремонте`)
		await load()
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
async function removeBlockAt(bandId) {
	if (!(await confirm({ title: "Снять ремонт?", danger: true, confirmLabel: "Снять" }))) return
	try {
		await del("/blocks/" + bandId)
		toast.success("Ремонт снят")
		await load()
	} catch (e) {
		toast.error(e.message)
	}
}

function locate(clientX, clientY) {
	const el = scrollEl.value
	if (!el) return null
	const rect = el.getBoundingClientRect()
	const x = clientX - rect.left + el.scrollLeft
	const y = clientY - rect.top + el.scrollTop
	if (x < LEFT || y < HEAD) return { region: "frozen" }
	const col = Math.floor((x - LEFT) / colW.value)
	const row = Math.floor((y - HEAD) / rowH.value)
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
	const l = (dayDiff(from.value, p.date_from) + 0.5) * colW.value
	const r = (dayDiff(from.value, p.date_to) + 0.5) * colW.value
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
		const wasSelected = selectedId.value === loc.placement.id
		selectedId.value = loc.placement.id
		if (!canEdit) return startPan(e)
		let zone = ribbonZone(loc.placement, loc.gx)
		// Края тянутся только у уже выбранной ленты: первый клик выбирает, второй хватает край.
		// Иначе клик у самого края ленты незаметно продлевал бронь на день.
		if (!wasSelected && zone !== "move") zone = "move"
		Object.assign(drag, {
			id: loc.placement.id,
			p: loc.placement,
			kind: zone,
			startCol: loc.col,
			x0: e.clientX,
			y0: e.clientY,
		})
		mode.value = "armed"
		e.preventDefault()
		return
	}
	if ((canEdit || canRepair) && !loc.blocked) {
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
	// Ремонт [X,Y] занимает ночи по Y включительно, поэтому мешает брони [dFrom,dTo)
	// только при X < dTo и dFrom <= Y: ремонт с дня выезда уже не пересекается.
	for (const b of data.value.blocks) {
		if (f && b.room_id === f.room.id && b.date_from < dTo && dFrom <= b.date_to) return false
	}
	return true
}

function onMove(e) {
	if (!mode.value) {
		const loc = locate(e.clientX, e.clientY)
		hoverRow.value = loc?.region === "grid" ? loc.row : -1
	}
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
	if (mode.value === "armed") {
		// Пока мышь почти на месте — это клик, а не перетаскивание
		if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_THRESHOLD) return
		mode.value = drag.kind
	}
	if (mode.value === "move" || mode.value === "resize-l" || mode.value === "resize-r") {
		const loc = locate(e.clientX, e.clientY)
		if (!loc || loc.region !== "grid") return
		const p = drag.p
		const nights = dayDiff(p.date_from, p.date_to)
		let bedId = p.bed_id
		let dFrom = p.date_from
		let dTo = p.date_to
		if (mode.value === "move") {
			bedId = loc.f.bed.id
			// Сдвиг — от точки нажатия, а не от края экрана: у ленты, начатой левее видимого
			// периода, прежний расчёт прыгал на первый видимый день
			dFrom = addDays(p.date_from, loc.col - drag.startCol)
			dTo = addDays(dFrom, nights)
		} else if (mode.value === "resize-l") {
			dFrom = days.value[loc.col] || p.date_from
			if (dayDiff(dFrom, dTo) < 1) dFrom = addDays(dTo, -1)
		} else {
			dTo = days.value[loc.col] ? addDays(days.value[loc.col], 1) : p.date_to
			if (dayDiff(dFrom, dTo) < 1) dTo = addDays(dFrom, 1)
		}
		// Призрак показываем, только когда что-то реально меняется
		moved = bedId !== p.bed_id || dFrom !== p.date_from || dTo !== p.date_to
		Object.assign(ghost, { active: moved, p, bedId, from: dFrom, to: dTo, ok: rangeFree(bedId, dFrom, dTo, p.id), x: e.clientX, y: e.clientY })
		return
	}
	if (mode.value === null) hover(e)
}

async function onUp(e) {
	if (mode.value === "select" && sel.active) {
		const a = Math.min(sel.a, sel.b)
		const b = Math.max(sel.a, sel.b)
		const f = flatBeds.value[sel.row]
		// Спрашиваем, что делаем с выделенным диапазоном: селим человека или ставим номер на ремонт.
		// Ремонт — это room_blocks, профиль вахтовика для него не нужен.
		if (f) Object.assign(pick, { show: true, f, from: days.value[a], to: days.value[b] })
	} else if (mode.value === "armed" && drag.p) {
		openPlacement(drag.p) // обычный клик по ленте
	} else if (ghost.active && moved) {
		if (!ghost.ok) toast.error("Туда нельзя: место занято или номер на ремонте")
		else {
			// Не записываем сразу — показываем «было → стало» и ждём подтверждения
			Object.assign(confirmMove, { show: true, x: e?.clientX || 0, y: e?.clientY || 0 })
			mode.value = null
			return
		}
	}
	mode.value = null
	sel.active = false
	resetDrag()
	setTimeout(() => (moved = false), 0)
}
function resetDrag() {
	ghost.active = false
	drag.id = null
	drag.p = null
	confirmMove.show = false
}
function cancelMove() {
	resetDrag()
	moved = false
}
const bedName = (bedId) => {
	const f = flatBeds.value.find((x) => x.bed.id === bedId)
	return f ? `№ ${f.room.number} · ${f.bed.label}` : "—"
}
const range = (a, b) => `${dm(a)} – ${dm(b)}`
const confirmStyle = computed(() => ({
	left: Math.min(confirmMove.x + 12, window.innerWidth - 340) + "px",
	top: Math.min(confirmMove.y + 12, window.innerHeight - 220) + "px",
}))
async function applyMove() {
	confirmMove.show = false
	await commitGhost()
	resetDrag()
	moved = false
}
async function undoMove() {
	if (!lastMove) return
	const m = lastMove
	lastMove = null
	busy.value = true
	try {
		await put(`/placements/${m.id}`, m.prev)
		toast.success("Перенос отменён")
		await load()
	} catch (err) {
		toast.error(err.message)
	} finally {
		busy.value = false
	}
}

async function commitGhost() {
	const p = ghost.p
	const { bedId, from: dFrom, to: dTo, ok } = ghost
	ghost.active = false
	if (!ok) return toast.error("Место занято или на ремонте")
	if (bedId === p.bed_id && dFrom === p.date_from && dTo === p.date_to) return
	busy.value = true
	const base = { resident_id: p.resident_id, status_id: p.status_id, stage: p.stage, comment: p.comment }
	try {
		await put(`/placements/${p.id}`, { ...base, bed_id: bedId, date_from: dFrom, date_to: dTo })
		lastMove = { id: p.id, prev: { ...base, bed_id: p.bed_id, date_from: p.date_from, date_to: p.date_to } }
		toast.action(bedId === p.bed_id ? "Даты изменены" : "Бронь перенесена", "Отменить (Ctrl+Z)", undoMove)
		await load()
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}

function openPlacement(p) {
	const f = flatBeds.value.find((x) => x.bed.id === p.bed_id)
	placement.value = { bed: { id: p.bed_id, label: f ? `Номер № ${f.room.number} · ${f.bed.label}` : "" }, existing: p, date: p.date_from }
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
		// цвет ленты сменился на сервере вместе со стадией
		load()
		toast.success(`Стадия: «${STAGE_LABEL[stage]}»`)
	} catch (e) {
		toast.error(e.message)
	}
}
async function cancelBooking(p) {
	menu.show = false
	if (!(await confirm({ title: "Отменить бронь?", message: `${p.resident_name || p.status_name}, ${stayText(p)}`, danger: true, confirmLabel: "Отменить" }))) return
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
	const base = { bed_id: p.bed_id, resident_id: p.resident_id, status_id: p.status_id, stage: p.stage, comment: p.comment }
	put(`/placements/${p.id}`, { ...base, date_from: addDays(p.date_from, days), date_to: addDays(p.date_to, days) })
		.then(() => {
			menu.show = false
			lastMove = { id: p.id, prev: { ...base, date_from: p.date_from, date_to: p.date_to } }
			toast.action(days > 0 ? "Сдвинуто на день вперёд" : "Сдвинуто на день назад", "Отменить (Ctrl+Z)", undoMove)
			load()
		})
		.catch((e) => toast.error(e.message))
}

/* ---------- клавиатура ---------- */
const selectedPlacement = computed(() => data.value.placements.find((p) => p.id === selectedId.value) || null)

function onKey(e) {
	const tag = (e.target?.tagName || "").toLowerCase()
	const typing = tag === "input" || tag === "textarea" || tag === "select"
	if (confirmMove.show) {
		if (e.code === "Enter" || e.code === "NumpadEnter") (e.preventDefault(), applyMove())
		if (e.code === "Escape") (e.preventDefault(), cancelMove())
		return
	}
	if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !typing && lastMove) {
		e.preventDefault()
		return undoMove()
	}
	if (e.key === "Escape") {
		if (menu.show) return (menu.show = false)
		if (showHelp.value) return (showHelp.value = false)
		if (typing) return e.target.blur()
		selectedId.value = null
		return
	}
	if (typing) return
	// Сочетания с Ctrl/Alt/⌘ — браузерные (Ctrl+F, Ctrl+T), их не перехватываем
	if (e.ctrlKey || e.metaKey || e.altKey) return
	const p = selectedPlacement.value
	// e.code — физическая клавиша: в русской раскладке «F» приходит как «а»,
	// а код клавиши тот же, поэтому сочетания работают в любой раскладке
	switch (e.code) {
		case "ArrowRight":
			e.preventDefault()
			return shiftFrom(e.shiftKey ? 30 : 7)
		case "ArrowLeft":
			e.preventDefault()
			return shiftFrom(e.shiftKey ? -30 : -7)
		case "KeyT":
			return goToday()
		case "Digit1":
		case "Digit2":
		case "Digit3":
		case "Digit4":
			span.value = [7, 14, 30, 60][Number(e.code.slice(-1)) - 1]
			return load()
		case "KeyF":
			e.preventDefault()
			return searchEl.value?.focus?.()
		case "Slash":
			e.preventDefault()
			if (e.shiftKey) return (showHelp.value = true) // «?»
			return searchEl.value?.focus?.()
	}
	if (!p || !canEdit) return
	if (e.code === "Enter" || e.code === "NumpadEnter") return openPlacement(p)
	if (e.code === "Delete" || e.code === "Backspace") return cancelBooking(p)
	if (e.code === "KeyE") return p.stage === "expected" && quickStage(p, "checked_in")
	if (e.code === "KeyO") return p.stage === "checked_in" && quickStage(p, "checked_out")
	if (e.code === "BracketLeft") return nudge(p, -1)
	if (e.code === "BracketRight") return nudge(p, 1)
}

watch([hotelId], () => {})

const gridStyle = computed(() => ({
	"--rack-col": colW.value + "px",
	"--rack-row": rowH.value + "px",
	"--rack-num": NUM + "px",
	"--rack-bed": BED + "px",
	width: LEFT + span.value * colW.value + "px",
}))
const selStyle = computed(() => {
	if (!sel.active) return null
	const a = Math.min(sel.a, sel.b)
	const b = Math.max(sel.a, sel.b)
	return { top: sel.row * rowH.value + "px", left: a * colW.value + "px", width: (b - a + 1) * colW.value + "px", height: rowH.value + "px" }
})
</script>

<template>
	<div class="grid">
		<div class="toolbar">
			<div class="toolbar__row">
				<Select v-model="hotelId" class="tb-hotel" title="Гостиница" @change="load">
					<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
				</Select>
				<div class="tb-nav">
					<IconButton icon="chevron-left" label="Неделя назад" @click="shiftFrom(-7)" />
					<DateInput v-model="from" title="Начало периода" style="width: 11rem" @change="load" />
					<IconButton icon="chevron-right" label="Неделя вперёд" @click="shiftFrom(7)" />
					<Button @click="goToday">Сегодня</Button>
				</div>
				<SegmentedControl :model-value="span" :options="SPANS" title="Сколько дней показывать" @update:model-value="(v) => { span = v; load() }" />
				<span class="toolbar__grow" />
				<div class="search-wrap">
					<Icon name="search" class="search-ic" />
					<Input
						ref="searchEl"
						v-model="search"
						placeholder="Найти проживающего (F)"
						style="padding-left: 2.2rem"
						@keydown.enter.prevent="jumpHit($event.shiftKey ? -1 : 1)"
					/>
					<span
						v-if="search.trim()"
						class="hits"
						:class="{ none: !searchHits }"
						:title="searchHits ? 'Enter — к следующему, Shift+Enter — к предыдущему' : 'Ничего не найдено'"
					>{{ searchHits ? (hitIdx >= 0 ? `${hitIdx + 1} из ${searchHits}` : `${searchHits} · Enter`) : "нет" }}</span>
				</div>
				<IconButton icon="info" label="Как пользоваться (?)" @click="showHelp = true" />
			</div>
			<div class="toolbar__row">
				<Select v-model="classFilter" class="tb-small" title="Тип номера">
					<option value="">Все типы номеров</option>
					<option v-for="c in classOptions" :key="c" :value="c">{{ c }}</option>
				</Select>
				<Select v-if="floorOptions.length > 1" v-model="floorFilter" class="tb-small" title="Этаж">
					<option value="">Все этажи</option>
					<option v-for="fl in floorOptions" :key="fl" :value="fl">{{ fl }} этаж</option>
				</Select>
				<button type="button" class="toggle" :class="{ on: onlyFree }" title="Только номера, где в этот период есть хотя бы одна свободная ночь" @click="onlyFree = !onlyFree">
					<Icon :name="onlyFree ? 'check' : 'plus'" size="0.9em" /> Только со свободными
				</button>
				<button type="button" class="toggle" :class="{ on: dense }" title="Компактные строки: больше мест на экране" @click="dense = !dense">
					<Icon :name="dense ? 'check' : 'plus'" size="0.9em" /> Компактно
				</button>
				<span class="toolbar__grow" />
				<div class="legend">
					<span v-for="s in bookingStatuses" :key="s.id" class="leg"><StatusDot :color="s.color" /> {{ s.name }}</span>
					<span class="leg" title="Бронь оформлена, человек ещё не заселён"><i class="sw sw-exp" /> ожидается заезд</span>
					<span class="leg" title="Номер снят с брони на время ремонта"><i class="sw sw-repair" :style="{ '--rep': repairColor }" /> {{ repairName }}</span>
				</div>
			</div>
		</div>

		<div ref="scrollEl" class="rack" :class="{ busy, dense }" @pointerdown="onDown" @contextmenu="onContext" @pointerleave="schedulePopHide">
			<div class="rack-inner" :style="gridStyle">
				<!-- шапка -->
				<div class="head">
					<div class="corner">
						<span class="corner__cols">Номер · место</span>
						<span class="corner__free">свободных мест</span>
					</div>
					<div class="months">
						<div v-for="m in monthSpans" :key="m.key" class="month" :style="{ width: m.colspan * colW + 'px' }">{{ m.label }}</div>
					</div>
					<div class="daysrow">
						<div v-for="d in dayInfo" :key="d.date" class="day" :class="{ we: d.weekend, today: d.today }" :title="fullDate(d.date)">
							<span class="wd">{{ d.wd }}</span><span class="dn">{{ d.num }}</span>
						</div>
					</div>
					<div class="freerow" title="Сколько спальных мест остаётся свободными в каждый день">
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
						<div v-for="f in flatBeds" :key="f.bed.id" class="rowlabel" :class="{ hl: f.rowIndex === hoverRow }" :style="{ top: f.rowIndex * rowH + 'px' }">
							<div class="num" :class="{ first: f.first }">
								<template v-if="f.first"><b>№ {{ f.room.number }}</b><span class="cls">{{ f.room.class_name || "—" }}</span></template>
							</div>
							<div class="bedname">{{ f.bed.label }}</div>
						</div>
					</div>

					<div class="canvas" :style="{ width: span * colW + 'px', height: layout.height + 'px' }">
						<div v-for="(d, i) in dayInfo" :key="d.date" class="colline" :class="{ we: d.weekend }" :style="{ left: i * colW + 'px' }" />
						<div v-for="f in flatBeds" :key="'r' + f.bed.id" class="rowline" :style="{ top: (f.rowIndex + 1) * rowH + 'px' }" />
						<div v-if="hoverRow >= 0" class="rowhl" :style="{ top: hoverRow * rowH + 'px', height: rowH + 'px' }" />
						<div v-if="layout.todayX != null" class="todayline" :style="{ left: layout.todayX + 'px' }" />

						<div
							v-for="b in layout.bands"
							:key="'b' + b.id"
							class="band"
							:class="{ clickable: canRepair }"
							:style="{ top: b.top + 'px', left: b.leftPx + 'px', width: b.width + 'px', height: b.height + 'px', '--rep': repairColor }"
							:title="`Ремонт${b.reason ? ': ' + b.reason : ''}${canRepair ? ' — нажмите, чтобы снять' : ''}`"
							@pointerdown.stop
							@click="canRepair && removeBlockAt(b.id)"
						/>

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
							:style="{ top: r.row * rowH + 3 + 'px', left: r.leftPx + 'px', width: r.width + 'px', height: rowH - 6 + 'px', '--rc': r.color }"
						>
							<span class="rlabel">{{ r.label }}</span>
							<span v-if="r.width > 150 && !r.ghost" class="rnights">{{ r.nights }} {{ nightsWord(r.nights) }}</span>
							<i v-if="!r.ghost && canEdit" class="grip grip-l" />
							<i v-if="!r.ghost && canEdit" class="grip grip-r" />
						</div>

						<div v-if="selStyle" class="selbox" :style="selStyle" />
					</div>
				</div>
			</div>
		</div>

		<!-- Подпись у курсора при перетаскивании: куда и на какие даты -->
		<div v-if="ghost.active && !confirmMove.show" class="drag-tip" :class="{ bad: !ghost.ok }" :style="{ left: ghost.x + 16 + 'px', top: ghost.y + 16 + 'px' }">
			<template v-if="ghost.ok">
				<b>{{ range(ghost.from, ghost.to) }}</b> · {{ dayDiff(ghost.from, ghost.to) }} {{ nightsWord(dayDiff(ghost.from, ghost.to)) }}
				<span v-if="ghost.bedId !== ghost.p?.bed_id" class="drag-tip__bed">→ {{ bedName(ghost.bedId) }}</span>
			</template>
			<template v-else>Занято — отпустите в другом месте</template>
		</div>

		<!-- Подтверждение переноса -->
		<template v-if="confirmMove.show && ghost.p">
			<div class="confirm-catch" @pointerdown="cancelMove" />
			<div class="confirm-move" :style="confirmStyle" role="dialog" aria-label="Подтверждение переноса">
				<div class="confirm-move__title">{{ ghost.bedId !== ghost.p.bed_id ? "Перенести бронь?" : "Изменить даты?" }}</div>
				<div class="confirm-move__who">{{ ghost.p.resident_name || ghost.p.status_name }}</div>
				<div v-if="ghost.bedId !== ghost.p.bed_id" class="confirm-move__row">
					<span class="muted">Место</span><s>{{ bedName(ghost.p.bed_id) }}</s><Icon name="arrow-right" size="0.8em" /><b>{{ bedName(ghost.bedId) }}</b>
				</div>
				<div v-if="ghost.from !== ghost.p.date_from || ghost.to !== ghost.p.date_to" class="confirm-move__row">
					<span class="muted">Даты</span><s>{{ range(ghost.p.date_from, ghost.p.date_to) }}</s><Icon name="arrow-right" size="0.8em" /><b>{{ range(ghost.from, ghost.to) }}</b>
				</div>
				<div class="confirm-move__acts">
					<Button variant="ghost" size="sm" @click="cancelMove">Отмена <kbd>Esc</kbd></Button>
					<Button variant="primary" size="sm" icon="check" @click="applyMove">Применить <kbd>Enter</kbd></Button>
				</div>
			</div>
		</template>

		<!-- поповер -->
		<div v-if="pop.show && pop.p" class="pop" :class="{ above: pop.above }" :style="{ left: pop.x + 'px', top: pop.y + 'px' }" @pointerenter="keepPopover" @pointerleave="schedulePopHide">
			<div class="row" style="gap: var(--gap-sm)">
				<StatusDot :color="pop.p.status_color" size="12px" />
				<b class="contrast">{{ pop.p.resident_name || pop.p.status_name }}</b>
			</div>
			<div class="muted pop-sub">{{ stayText(pop.p) }}</div>
			<div class="muted pop-sub">{{ STAGE_LABEL[pop.p.stage] || pop.p.status_name }}</div>
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

		<!-- Что делаем с выделенным диапазоном -->
		<Modal v-if="pick.show" :title="`№ ${pick.f.room.number} · ${pick.f.bed.label}`" @close="pick.show = false">
			<p class="pick-dates">{{ pickStayText }}</p>
			<div class="pick-opts">
				<button v-if="canEdit" type="button" class="pick-opt" @click="pickBooking">
					<Icon name="user" size="1.3rem" />
					<span>
						<b>Заселить вахтовика</b>
						<span class="muted">бронь на это место, нужен профиль проживающего</span>
					</span>
				</button>
				<button v-if="canRepair" type="button" class="pick-opt" @click="pickRepair">
					<Icon name="wrench" size="1.3rem" />
					<span>
						<b>Поставить на ремонт</b>
						<span class="muted">весь номер № {{ pick.f.room.number }}, профиль не нужен</span>
					</span>
				</button>
			</div>
		</Modal>

		<!-- Ремонт: только период и причина -->
		<Modal v-if="repairForm.show" :title="`Ремонт номера № ${pick.f.room.number}`" @close="repairForm.show = false">
			<p class="pick-dates">{{ pickRepairText }} · на это время номер нельзя забронировать</p>
			<Input v-model="repairForm.reason" placeholder="Причина (необязательно): течёт кран, замена окна…" />
			<template #foot>
				<Button variant="ghost" @click="repairForm.show = false">Отмена</Button>
				<Button variant="primary" icon="wrench" :loading="busy" @click="submitRepair">На ремонт</Button>
			</template>
		</Modal>

		<Modal v-if="showHelp" title="Как пользоваться календарём броней" @close="showHelp = false">
			<p class="help-intro">
				Каждая строка — одно спальное место, каждый столбец — сутки. Цветная лента поперёк дней — это бронь:
				она начинается в день заезда и заканчивается в день выезда. В день выезда место уже свободно —
				в него можно селить следующего вахтовика (пересменка).
			</p>
			<p class="help-intro muted">Клавиши работают в любой раскладке — переключать на английский не нужно.</p>
			<div class="keys">
				<div class="kgroup">
					<h4>Навигация</h4>
					<div class="krow"><kbd>←</kbd><kbd>→</kbd><span>неделя назад / вперёд</span></div>
					<div class="krow"><kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd><span>месяц</span></div>
					<div class="krow"><kbd>T · Е</kbd><span>к сегодняшнему дню</span></div>
					<div class="krow"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>период 7 / 14 / 30 / 60 дней</span></div>
					<div class="krow"><kbd>F · А</kbd><span>поиск проживающего</span></div>
				</div>
				<div class="kgroup">
					<h4>Бронь (выберите ленту кликом)</h4>
					<div class="krow"><kbd>Enter</kbd><span>открыть карточку</span></div>
					<div class="krow"><kbd>E · У</kbd><span>заселить</span></div>
					<div class="krow"><kbd>O · Щ</kbd><span>выселить</span></div>
					<div class="krow"><kbd>[ · Х</kbd><kbd>] · Ъ</kbd><span>сдвинуть на день</span></div>
					<div class="krow"><kbd>Del</kbd><span>отменить бронь</span></div>
					<div class="krow"><kbd>Esc</kbd><span>снять выделение</span></div>
				</div>
				<div class="kgroup">
					<h4>Мышь</h4>
					<div class="krow"><span class="gesture">Протяжка по пустым клеткам</span><span>бронь или ремонт — на выбор</span></div>
					<div class="krow"><span class="gesture">Клик по полосе ремонта</span><span>снять ремонт</span></div>
					<div class="krow"><span class="gesture">Тянуть ленту</span><span>перенос — с подтверждением, отмена Ctrl+Z</span></div>
					<div class="krow"><span class="gesture">Выбрать ленту, тянуть за край</span><span>продлить / сократить</span></div>
					<div class="krow"><span class="gesture">Правый клик</span><span>меню действий</span></div>
					<div class="krow"><span class="gesture">Тянуть фон / средняя кнопка</span><span>прокрутка</span></div>
				</div>
			</div>
		</Modal>

		<PlacementModal v-if="placement" v-bind="placement" @close="placement = null" @saved="onSaved" />
	</div>
</template>

<style scoped>
/* Тулбар: все контролы одной высоты (--control-h-md), подписи — в title/placeholder,
   чтобы ряд не «прыгал» от подписей разной высоты */
.toolbar {
	display: grid;
	gap: var(--gap-sm);
}
.toolbar__row {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.toolbar__grow {
	flex: 1;
}
.tb-hotel {
	width: auto;
	max-width: 22rem;
	font-weight: var(--font-weight-bold);
}
.tb-small {
	width: auto;
}
.tb-nav {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.toggle {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border: 1px solid var(--color-button-border);
	border-radius: var(--radius-md);
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
	white-space: nowrap;
}
.toggle:hover {
	color: var(--color-contrast);
	border-color: var(--color-brand);
}
.toggle.on {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.search-wrap {
	position: relative;
	width: 17rem;
	max-width: 100%;
}
.search-ic {
	position: absolute;
	left: 0.8rem;
	top: 50%;
	transform: translateY(-50%);
	color: var(--color-secondary);
	pointer-events: none;
	z-index: 1;
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
	align-items: center;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.legend__title {
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-secondary);
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
	--rep: var(--color-orange);
	background: repeating-linear-gradient(45deg, var(--rep) 0 3px, transparent 3px 6px);
	border: 1px solid var(--rep);
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
	flex-direction: column;
	justify-content: flex-end;
	padding: 0 var(--gap-sm);
	background: var(--color-raised-bg);
	border-right: 1px solid var(--color-divider);
	z-index: 2;
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-secondary);
}
/* Подписи к двум нижним строкам шапки: колонки слева и итог свободных мест по дням */
.corner__cols {
	height: 38px;
	display: flex;
	align-items: flex-end;
	padding-bottom: 4px;
}
.corner__free {
	height: 22px;
	line-height: 22px;
	font-size: 10px;
	font-weight: 400;
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
	--rep: var(--color-orange);
	background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--rep), transparent 70%) 0 5px, transparent 5px 10px);
	border: 1px solid var(--rep);
	border-radius: var(--radius-sm);
	z-index: 1;
}
.band.clickable {
	cursor: pointer;
}
.band.clickable:hover {
	background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--rep), transparent 50%) 0 5px, transparent 5px 10px);
}
.pick-dates {
	margin: 0 0 var(--gap-md);
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.pick-opts {
	display: grid;
	gap: var(--gap-sm);
}
.pick-opt {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	width: 100%;
	padding: var(--gap-md);
	font: inherit;
	text-align: left;
	cursor: pointer;
	color: var(--color-base);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.pick-opt:hover {
	border-color: var(--color-brand);
}
.pick-opt :deep(svg) {
	color: var(--color-brand);
	flex-shrink: 0;
}
.pick-opt b {
	display: block;
	color: var(--color-contrast);
}
.pick-opt .muted {
	font-size: var(--font-size-xs);
}
.ribbon {
	position: absolute;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 10px;
	/* Цвет статуса — в обводке и полосе слева, заливка приглушённая: при сотнях
	   лент сплошной ярко-зелёный слепит и забивает текст */
	background: color-mix(in srgb, var(--rc) 26%, var(--color-raised-bg));
	border: 1px solid color-mix(in srgb, var(--rc) 70%, transparent);
	box-shadow: inset 3px 0 0 var(--rc);
	color: var(--color-contrast);
	border-radius: 4px;
	font-size: 11px;
	font-weight: 700;
	transition: background var(--speed-fast);
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
.ribbon:hover {
	background: color-mix(in srgb, var(--rc) 38%, var(--color-raised-bg));
}
.ribbon.exp {
	background: repeating-linear-gradient(
		45deg,
		color-mix(in srgb, var(--rc) 26%, var(--color-raised-bg)) 0 6px,
		color-mix(in srgb, var(--rc) 10%, var(--color-raised-bg)) 6px 12px
	);
	border-style: dashed;
}
/* Края для растягивания — только у выбранной ленты */
.ribbon:not(.sel) .grip {
	display: none;
}
.ribbon:not(.sel) {
	cursor: pointer;
}
.drag-tip {
	position: fixed;
	z-index: calc(var(--z-popover) + 5);
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 10px;
	border-radius: var(--radius-md);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-brand);
	box-shadow: var(--shadow-floating);
	color: var(--color-base);
	font-size: var(--font-size-xs);
	white-space: nowrap;
	pointer-events: none;
}
.drag-tip b {
	color: var(--color-contrast);
}
.drag-tip.bad {
	border-color: var(--color-red);
	color: var(--color-red);
}
.drag-tip__bed {
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.confirm-catch {
	position: fixed;
	inset: 0;
	z-index: calc(var(--z-popover) + 5);
}
.confirm-move {
	position: fixed;
	z-index: calc(var(--z-popover) + 6);
	width: 320px;
	display: grid;
	gap: 6px;
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	box-shadow: var(--shadow-floating), 0 18px 40px rgba(0, 0, 0, 0.35);
	font-size: var(--font-size-sm);
	animation: k-pop-in 140ms ease;
}
@keyframes k-pop-in {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
}
.confirm-move__title {
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.confirm-move__who {
	color: var(--color-secondary);
	margin-top: -4px;
}
.confirm-move__row {
	display: grid;
	grid-template-columns: 3.2rem auto auto 1fr;
	align-items: center;
	gap: 6px;
	font-size: var(--font-size-xs);
}
.confirm-move__row s {
	color: var(--color-secondary);
}
.confirm-move__row b {
	color: var(--color-contrast);
}
.confirm-move__acts {
	display: flex;
	justify-content: flex-end;
	gap: 6px;
	margin-top: 4px;
}
.confirm-move__acts kbd {
	font-size: 0.65rem;
	opacity: 0.7;
	margin-left: 4px;
}
.rnights {
	margin-left: auto;
	font-weight: 500;
	opacity: 0.7;
	flex-shrink: 0;
}
.rack.dense .cls {
	display: none;
}
.rack.dense .ribbon {
	font-size: 10px;
}
.rowhl {
	position: absolute;
	left: 0;
	right: 0;
	background: color-mix(in srgb, var(--color-brand) 8%, transparent);
	pointer-events: none;
}
.rowlabel.hl {
	background: color-mix(in srgb, var(--color-brand) 10%, var(--color-raised-bg));
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
.help-intro {
	margin: 0 0 var(--gap-md);
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
	line-height: 1.5;
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
