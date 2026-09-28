<script setup>
import { ref, computed, onMounted } from "vue"
import { api } from "@/api/client"
import { today, addDays, nightsBetween, nightsWord, dm } from "@/utils/date"
import { useAuthStore } from "@/stores/auth"
import PlacementModal from "@/components/PlacementModal.vue"
import Icon from "@/components/Icon.vue"
import { FilterBar, Field, Input, Select, Button, Stat, Card, EmptyState, DateRange } from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const hotels = ref([])
const classes = ref([])
const hotelId = ref("")
const classId = ref("")
const from = ref(today())
const to = ref(addDays(today(), 7))
const result = ref(null)
const loading = ref(false)
const placement = ref(null)

// Период считаем ночами: с 5-го по 7-е — это две ночи, 7-го место уже свободно.
const nightsCount = computed(() => Math.max(0, nightsBetween(from.value, to.value)))

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
	// Период поиска сразу переносим в бронь: ради него место и искали
	placement.value = { bed: { id: bed.bed_id, label: `Номер № ${room.number} · ${bed.bed_label}` }, date: from.value, dateTo: to.value }
}
function onSaved() {
	placement.value = null
	search()
}
</script>

<template>
	<div class="grid">

		<FilterBar>
			<Field label="Заезд — выезд"><DateRange v-model:from="from" v-model:to="to" style="min-width: 17rem" @change="search" /></Field>
			<Field label="Гостиница"><Select v-model="hotelId" @change="search"><option value="">Все</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select></Field>
			<Field label="Тип номера"><Select v-model="classId" @change="search"><option value="">Все</option><option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option></Select></Field>
			<Button variant="brand" icon="search" @click="search">Найти</Button>
		</FilterBar>

		<p class="lead">
			Показаны места, свободные весь период —
			<b class="contrast">{{ dm(from) }} → {{ dm(to) }}</b> ({{ nightsCount }} {{ nightsWord(nightsCount) }}).
			День выезда не занимает ночь: место освобождается утром и в этот же день доступно следующему.
		</p>

		<div v-if="loading" class="muted">Поиск…</div>
		<template v-else-if="result">
			<div class="kpis">
				<Stat :value="result.totals.free_beds" label="Свободных мест" accent />
				<Stat :value="result.totals.rooms_with_space" label="Номеров со свободными" />
				<Stat :value="result.totals.fully_free_rooms" label="Полностью свободных" />
			</div>

			<Card v-if="!result.rooms.length"><EmptyState icon="bed" title="Свободных мест нет" text="На этот период всё занято" /></Card>
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
.lead {
	margin: 0;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
	max-width: 70ch;
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
