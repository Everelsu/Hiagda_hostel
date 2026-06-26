<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"
import Icon from "@/components/Icon.vue"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const hotels = ref([])
const classes = ref([])
const hotelId = ref("")
const classId = ref("")
const from = ref(new Date().toISOString().slice(0, 10))
const to = ref(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10))
const result = ref(null)
const loading = ref(false)
const placement = ref(null)

onMounted(async () => {
	;[hotels.value, classes.value] = await Promise.all([api("/hotels"), api("/classes")])
	search()
})

async function search() {
	loading.value = true
	try {
		const qs = new URLSearchParams({ from: from.value, to: to.value })
		if (hotelId.value) qs.set("hotel_id", hotelId.value)
		if (classId.value) qs.set("class_id", classId.value)
		result.value = await api("/availability?" + qs)
	} finally {
		loading.value = false
	}
}
function place(room, bed) {
	placement.value = { bed: { id: bed.bed_id, label: `№ ${room.number} · ${bed.bed_label}` } }
}
function onSaved() {
	placement.value = null
	search()
}
</script>

<template>
	<div class="grid">
		<div>
			<h1>Свободные места</h1>
			<p class="muted" style="margin-top: 2px">Кто свободен на выбранный период — для заселения вахты</p>
		</div>

		<div class="card row wrap" style="align-items: flex-end">
			<div class="field" style="margin: 0"><label>С</label><input v-model="from" type="date" style="width: auto" @change="search" /></div>
			<div class="field" style="margin: 0"><label>По</label><input v-model="to" type="date" style="width: auto" @change="search" /></div>
			<div class="field" style="margin: 0"><label>Гостиница</label><select v-model="hotelId" style="width: auto" @change="search"><option value="">Все</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></select></div>
			<div class="field" style="margin: 0"><label>Тип</label><select v-model="classId" style="width: auto" @change="search"><option value="">Все</option><option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
			<button class="btn btn-brand" @click="search">Найти</button>
		</div>

		<div v-if="loading" class="muted">Поиск…</div>
		<template v-else-if="result">
			<div class="kpis">
				<div class="kpi accent"><div class="v">{{ result.totals.free_beds }}</div><div class="l">Свободных мест</div></div>
				<div class="kpi"><div class="v">{{ result.totals.rooms_with_space }}</div><div class="l">Номеров со свободными</div></div>
				<div class="kpi"><div class="v">{{ result.totals.fully_free_rooms }}</div><div class="l">Полностью свободных</div></div>
			</div>

			<p v-if="!result.rooms.length" class="card muted">На этот период свободных мест нет.</p>
			<div v-for="room in result.rooms" :key="room.room_id" class="card room">
				<div class="spread">
					<div>
						<div class="contrast row" style="font-weight: 700; gap: 6px"><Icon name="bed" /> № {{ room.number }} <span class="muted" style="font-weight: 400">· {{ room.hotel_name }}<template v-if="room.class_name"> · {{ room.class_name }}</template><template v-if="room.floor != null"> · этаж {{ room.floor }}</template></span></div>
						<div class="muted" style="font-size: var(--font-size-sm)">Свободно {{ room.free_beds.length }} из {{ room.capacity }}</div>
					</div>
				</div>
				<div class="row wrap" style="margin-top: var(--gap-sm)">
					<div v-for="bed in room.free_beds" :key="bed.bed_id" class="bedchip">
						<span class="grow">{{ bed.bed_label }}</span>
						<button v-if="canEdit" class="btn btn-sm btn-primary" @click="place(room, bed)">Заселить</button>
					</div>
				</div>
			</div>
		</template>

		<PlacementModal v-if="placement" :bed="placement.bed" :date="from" :date-to="to" @saved="onSaved" @close="placement = null" />
	</div>
</template>

<style scoped>
.kpis {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: var(--gap-md);
}
.kpi {
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	padding: var(--gap-md) var(--gap-lg);
	box-shadow: var(--shadow-card);
}
.kpi.accent {
	background: var(--color-green-bg);
	border-color: var(--color-green);
}
.kpi .v {
	font-size: var(--font-size-xl);
	font-weight: 800;
	color: var(--color-contrast);
}
.kpi.accent .v {
	color: var(--color-green);
}
.kpi .l {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.bedchip {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-xs) var(--gap-sm) var(--gap-xs) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	min-width: 160px;
}
</style>
