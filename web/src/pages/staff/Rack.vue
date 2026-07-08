<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue"
import { api } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"
import { PageHeader, FilterBar, Field, Select, Input, Button, StatusDot } from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const hotels = ref([])
const hotelId = ref(null)

// Стартовая дата строго в местном времени часового пояса ПК
const from = ref((() => {
	const d = new Date()
	const yyyy = d.getFullYear()
	const mm = String(d.getMonth() + 1).padStart(2, "0")
	const dd = String(d.getDate()).padStart(2, "0")
	return `${yyyy}-${mm}-${dd}`
})())
const span = ref(30);

const allRooms = ref([])
const placements = ref([])
const statuses = ref([])
const placement = ref(null)
const loading = ref(false)

const classFilter = ref("")
const classOptions = computed(() => [...new Set(allRooms.value.map((r) => r.class_name).filter(Boolean))])
const rooms = computed(() => {
	if (!classFilter.value) return allRooms.value
	return allRooms.value.filter((rm) => rm.class_name === classFilter.value)
})

const days = computed(() => {
	const out = []
	const [year, month, day] = from.value.split("-").map(Number)
	const start = new Date(year, month - 1, day)

	for (let i = 0; i < span.value; i++) {
		const d = new Date(start)
		d.setDate(d.getDate() + i)
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, "0")
		const dd = String(d.getDate()).padStart(2, "0")
		out.push(`${yyyy}-${mm}-${dd}`)
	}
	return out
})

onMounted(async () => {
	;[hotels.value, statuses.value] = await Promise.all([api("/hotels"), api("/statuses")])
	hotelId.value = hotels.value[0]?.id
	await load()
})

async function load() {
	if (!hotelId.value) return
	loading.value = true
	try {
		const to = days.value[days.value.length - 1]
		const [r, p] = await Promise.all([
			api(`/rooms?hotel_id=${hotelId.value}`),
			api(`/placements?from=${from.value}&to=${to}`)
		])
		allRooms.value = r;
		const bedIds = new Set(r.flatMap((rm) => rm.beds.map((b) => b.id)))
		placements.value = p.filter((x) => bedIds.has(x.bed_id))
	} finally {
		loading.value = false
	}
}

function shiftFrom(delta) {
	const [year, month, day] = from.value.split("-").map(Number)
	const d = new Date(year, month - 1, day)
	d.setDate(d.getDate() + delta)

	const yyyy = d.getFullYear()
	const mm = String(d.getMonth() + 1).padStart(2, "0")
	const dd = String(d.getDate()).padStart(2, "0")
	from.value = `${yyyy}-${mm}-${dd}`
	load()
}

function cellFor(bedId, day) {
	return placements.value.find((p) => p.bed_id === bedId && p.stage !== "cancelled" && p.date_from <= day && p.date_to >= day)
}
function cellCls(bedId, day) {
	const p = cellFor(bedId, day)
	const cls = { weekend: dayLabel(day).weekend }
	if (!p) return cls
	cls.busy = true
	cls.start = p.date_from === day || day === days.value[0]
	cls.end = p.date_to === day || day === days.value[days.value.length - 1]
	return cls
}
function startName(bedId, day) {
	const p = cellFor(bedId, day)
	if (p && (p.date_from === day || day === days.value[0])) return p.resident_name || p.status_name
	return ""
}
function dayLabel(day) {
	const d = new Date(day + "T00:00:00")
	return { d: d.getDate(), wd: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][d.getDay()], weekend: d.getDay() === 0 || d.getDay() === 6, today: day === new Date().toISOString().slice(0, 10) }
}
function onCell(bed, day, p) {
	if (!canEdit || dragMoved.value) return
	placement.value = { bed: { id: bed.id, label: bed.label }, existing: p || null, date: day }
}
function onSaved() {
	placement.value = null
	load()
}

const rackWrap = ref(null)
const dragMoved = ref(false)
let dragging = false
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0

function onDragStart(e) {
	if (e.button !== 0) return
	dragging = true
	dragMoved.value = false
	startX = e.clientX
	startY = e.clientY
	startLeft = rackWrap.value.scrollLeft
	startTop = rackWrap.value.scrollTop
}
function onDragMove(e) {
	if (!dragging) return
	const dx = e.clientX - startX
	const dy = e.clientY - startY
	if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved.value = true
	rackWrap.value.scrollLeft = startLeft - dx
	rackWrap.value.scrollTop = startTop - dy
}
function onDragEnd() {
	dragging = false
	setTimeout(() => (dragMoved.value = false), 0)
}

onMounted(() => {
	window.addEventListener("mousemove", onDragMove)
	window.addEventListener("mouseup", onDragEnd)
})
onUnmounted(() => {
	window.removeEventListener("mousemove", onDragMove)
	window.removeEventListener("mouseup", onDragEnd)
})
</script>

<template>
	<div class="grid">
		<PageHeader title="Бронирование" subtitle="Шахматка — тяните мышью, чтобы листать" icon="calendar" />

		<FilterBar>
			<Field label="Гостиница"><Select v-model="hotelId" @change="load"><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select></Field>
			<Field label="С даты"><Input v-model="from" type="date" @change="load" /></Field>
			<Field label="Период"><Select v-model.number="span" @change="load"><option :value="7">7 дней</option><option :value="14">14 дней</option><option :value="30">30 дней</option></Select></Field>
			<Field label="Класс номера"><Select v-model="classFilter"><option value="">Все типы</option><option v-for="c in classOptions" :key="c" :value="c">{{ c }}</option></Select></Field>
			<Button size="sm" icon="chevron-left" @click="shiftFrom(-span)">Назад</Button>
			<Button size="sm" @click="shiftFrom(span)">Вперёд</Button>
			<span class="grow" />
			<div class="legend row wrap">
				<span v-for="s in statuses" :key="s.id" class="leg"><StatusDot :color="s.color" /> {{ s.name }}</span>
			</div>
		</FilterBar>

		<div v-if="loading" class="muted">Загрузка…</div>
		<div v-else ref="rackWrap" class="rack-wrap" @mousedown="onDragStart">
			<table class="rack">
				<thead>
					<tr>
						<th class="corner">Номер · место</th>
						<th v-for="day in days" :key="day" class="dh" :class="{ weekend: dayLabel(day).weekend, today: dayLabel(day).today }">
							<div class="wd">{{ dayLabel(day).wd }}</div>
							<div class="dd">{{ dayLabel(day).d }}</div>
						</th>
					</tr>
				</thead>
				<tbody>
					<template v-for="room in rooms" :key="room.id">
						<tr class="room-row">
							<td class="rl room-head" :colspan="days.length + 1">№ {{ room.number }} <span class="muted">· {{ room.class_name || "—" }}</span></td>
						</tr>
						<tr v-for="bed in room.beds" :key="bed.id">
							<td class="rl">{{ bed.label }}</td>
							<td
								v-for="day in days"
								:key="day"
								class="cell"
								:class="cellCls(bed.id, day)"
								:style="cellFor(bed.id, day) ? { background: cellFor(bed.id, day).status_color } : null"
								:title="cellFor(bed.id, day) ? (cellFor(bed.id, day).resident_name || cellFor(bed.id, day).status_name) : 'свободно'"
								@click="onCell(bed, day, cellFor(bed.id, day))"
							>
								<span v-if="startName(bed.id, day)" class="cname">{{ startName(bed.id, day) }}</span>
							</td>
						</tr>
					</template>
				</tbody>
			</table>
		</div>

		<PlacementModal
			v-if="placement"
			:bed="placement.bed"
			:existing="placement.existing"
			:date="placement.date"
			@saved="onSaved"
			@close="placement = null"
		/>
	</div>
</template>

<style scoped>
.legend {
	gap: var(--gap-md);
}
.leg {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.ldot {
	width: 10px;
	height: 10px;
	border-radius: var(--radius-max);
}
.rack-wrap {
	overflow: auto;
	max-height: calc(100vh - 220px);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	cursor: grab;
	user-select: none;
}
.rack-wrap:active {
	cursor: grabbing;
}
.rack {
	border-collapse: separate;
	border-spacing: 0;
	font-size: var(--font-size-sm);
	width: max-content;
	min-width: 100%;
}
.rack th,
.rack td {
	border-right: 1px solid var(--color-divider);
	border-bottom: 1px solid var(--color-divider);
}
.corner,
.rl {
	position: sticky;
	left: 0;
	z-index: 2;
	background: var(--color-raised-bg);
	padding: var(--gap-xs) var(--gap-md);
	white-space: nowrap;
	text-align: left;
	min-width: 130px;
}
.room-head {
	font-weight: 700;
	color: var(--color-contrast);
	background: var(--color-bg);
}
.dh {
	padding: 2px 0;
	min-width: 38px;
	text-align: center;
	color: var(--color-secondary);
}
.dh .dd {
	font-weight: 700;
	color: var(--color-contrast);
}
.dh.weekend {
	background: var(--color-bg);
}
.dh.today {
	background: var(--color-brand-highlight);
}
.dh.today .dd {
	color: var(--color-brand);
}
.cell {
	min-width: 38px;
	height: 30px;
	cursor: pointer;
	position: relative;
	background: var(--color-super-raised-bg);
}
.cell.weekend {
	background: var(--color-bg);
}
.cell:hover {
	outline: 2px solid var(--color-brand);
	outline-offset: -2px;
}
.cell.busy {
	border-right-color: transparent;
}
.cell.busy.end {
	border-right: 1px solid var(--color-divider);
	border-top-right-radius: 7px;
	border-bottom-right-radius: 7px;
}
.cell.busy.start {
	border-top-left-radius: 7px;
	border-bottom-left-radius: 7px;
}
.cname {
	position: absolute;
	left: 6px;
	top: 50%;
	transform: translateY(-50%);
	white-space: nowrap;
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: #04150b;
	pointer-events: none;
	z-index: 1;
}
</style>
