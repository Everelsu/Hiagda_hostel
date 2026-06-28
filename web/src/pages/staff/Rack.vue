<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"

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

const rooms = computed(() => {
	if (!auth.roomClassFilter) return allRooms.value;
	return allRooms.value.filter(rm => rm.class_name === auth.roomClassFilter);
});

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
	if (!canEdit) return
	placement.value = { bed: { id: bed.id, label: bed.label }, existing: p || null, date: day }
}
function onSaved() {
	placement.value = null
	load()
}
</script>

<template>
	<div class="card row wrap" style="align-items: flex-end">
		<div class="field" style="margin: 0">
			<label>Гостиница</label>
			<select v-model="hotelId" style="width: auto" @change="load">
				<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
			</select>
		</div>
		<div class="field" style="margin: 0">
			<label>С даты</label>
			<input v-model="from" type="date" style="width: auto" @change="load" />
		</div>
		<div class="field" style="margin: 0">
			<label>Период</label>
			<select v-model.number="span" style="width: auto" @change="load">
				<option :value="7">7 дней</option>
				<option :value="14">14 дней</option>
				<option :value="30">30 дней</option>
			</select>
		</div>
		<button class="btn btn-sm" @click="shiftFrom(-span)">‹ Назад</button>
		<button class="btn btn-sm" @click="shiftFrom(span)">Вперёд ›</button>
		<div class="grow"></div>
		<div class="legend row wrap">
			<span v-for="s in statuses" :key="s.id" class="leg"><span class="ldot" :style="{ background: s.color }" /> {{ s.name }}</span>
		</div>
	</div>

		<div v-if="loading" class="muted">Загрузка…</div>
		<div v-else class="rack-wrap">
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
	overflow-x: auto;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
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
