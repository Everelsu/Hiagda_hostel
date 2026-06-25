<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import Modal from "@/components/Modal.vue"
import PlacementModal from "@/components/PlacementModal.vue"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const hotels = ref([])
const hotelId = ref(null)
const date = ref(new Date().toISOString().slice(0, 10))
const rooms = ref([])
const roomDetail = ref(null)
const placement = ref(null)

onMounted(async () => {
	hotels.value = await api("/hotels")
	hotelId.value = hotels.value[0]?.id
	await load()
})

async function load() {
	if (!hotelId.value) return
	const r = await api(`/plan?hotel_id=${hotelId.value}&date=${date.value}`)
	rooms.value = r.rooms
	if (roomDetail.value) roomDetail.value = rooms.value.find((x) => x.id === roomDetail.value.id) || null
}

const floors = computed(() => {
	const map = {}
	for (const r of rooms.value) (map[r.floor ?? "—"] ||= []).push(r)
	return Object.entries(map)
})
function tileClass(r) {
	if (r.occupied === 0) return "free"
	if (r.occupied >= r.capacity) return "full"
	return "part"
}
function openBed(bed) {
	if (!canEdit) return
	placement.value = { bed, existing: bed.placement }
}
async function onSaved() {
	placement.value = null
	await load()
}
</script>

<template>
	<div class="grid">
		<h1>План этажа</h1>
		<div class="row wrap">
			<select v-model="hotelId" style="width: auto" @change="load"><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></select>
			<input v-model="date" type="date" style="width: auto" @change="load" />
		</div>

		<div class="legend row wrap">
			<span class="chip"><span class="dot" style="background: var(--color-gray)" /> Свободно</span>
			<span class="chip"><span class="dot" style="background: var(--color-green)" /> Частично</span>
			<span class="chip"><span class="dot" style="background: var(--color-red)" /> Занят</span>
		</div>

		<div v-for="[floor, list] in floors" :key="floor" class="card">
			<div class="section-title">Этаж {{ floor }} <span class="muted" style="font-weight: 400">· {{ list.length }} ном.</span></div>
			<div class="tiles">
				<button
					v-for="r in list"
					:key="r.id"
					class="tile"
					:class="tileClass(r)"
					:title="r.beds.map((b) => `${b.label}: ${b.placement ? b.placement.resident_name || b.placement.status_name : 'свободно'}`).join('\n')"
					@click="roomDetail = r"
				>
					<div class="num">№ {{ r.number }}</div>
					<div class="sub">{{ r.class_name || "—" }} · {{ r.occupied }}/{{ r.capacity }}</div>
					<div class="beds"><span v-for="b in r.beds" :key="b.id" class="bd" :style="{ background: b.placement ? b.placement.status_color : 'transparent' }" /></div>
				</button>
			</div>
		</div>

		<Modal v-if="roomDetail" :title="'Номер № ' + roomDetail.number" @close="roomDetail = null">
			<p class="muted" style="margin: 0">Занято {{ roomDetail.occupied }} из {{ roomDetail.capacity }} · {{ date }}</p>
			<div class="grid" style="gap: var(--gap-sm)">
				<button v-for="b in roomDetail.beds" :key="b.id" class="bedrow" @click="openBed(b)">
					<span class="dot" :style="{ background: b.placement ? b.placement.status_color : 'var(--color-gray)' }" />
					<span class="grow">
						<b>{{ b.label }}</b> —
						<template v-if="b.placement">{{ b.placement.resident_name || b.placement.status_name }} <span class="muted">({{ b.placement.date_from }} – {{ b.placement.date_to }})</span></template>
						<template v-else><span class="muted">свободно</span></template>
					</span>
					<span v-if="canEdit" class="muted">✎</span>
				</button>
			</div>
		</Modal>

		<PlacementModal v-if="placement" :bed="placement.bed" :existing="placement.existing" :date="date" @saved="onSaved" @close="placement = null" />
	</div>
</template>

<style scoped>
.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	gap: var(--gap-md);
}
.tile {
	text-align: left;
	border: 1px solid var(--color-divider);
	border-left: 4px solid var(--color-gray);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	padding: var(--gap-md);
	cursor: pointer;
	font: inherit;
	color: var(--color-base);
}
.tile.free {
	border-left-color: var(--color-gray);
}
.tile.part {
	border-left-color: var(--color-green);
}
.tile.full {
	border-left-color: var(--color-red);
}
.tile:hover {
	border-color: var(--color-brand);
}
.num {
	font-weight: 800;
	color: var(--color-contrast);
}
.sub {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.beds {
	display: flex;
	gap: 3px;
	margin-top: var(--gap-sm);
}
.bd {
	flex: 1;
	height: 6px;
	border-radius: 3px;
	border: 1px solid var(--color-divider);
}
.bedrow {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	cursor: pointer;
	font: inherit;
	color: var(--color-base);
	text-align: left;
}
.bedrow:hover {
	border-color: var(--color-brand);
}
.bedrow .dot {
	width: 12px;
	height: 12px;
	border-radius: var(--radius-max);
	flex-shrink: 0;
}
.legend .dot {
	width: 10px;
	height: 10px;
	border-radius: var(--radius-max);
}
</style>
