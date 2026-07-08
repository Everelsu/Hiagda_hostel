<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"
import { PageHeader, FilterBar, Field, Input, Select, DataTable, StatusDot } from "@/ui"

const hotels = ref([])
const q = ref("")
const hotelId = ref("")
const from = ref("")
const to = ref("")
const rows = ref([])
const loading = ref(true)
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
const columns = [
	{ key: "resident_name", label: "Гость", sortable: true },
	{ key: "hotel_name", label: "Гостиница", sortable: true },
	{ key: "room_number", label: "Номер" },
	{ key: "bed_label", label: "Место" },
	{ key: "date_from", label: "Заезд", sortable: true },
	{ key: "date_to", label: "Выезд", sortable: true },
	{ key: "stage", label: "Стадия" },
]

let timer
function onSearch() {
	clearTimeout(timer)
	timer = setTimeout(load, 250)
}
async function load() {
	loading.value = true
	try {
		const qs = new URLSearchParams()
		if (q.value) qs.set("q", q.value)
		if (hotelId.value) qs.set("hotel_id", hotelId.value)
		if (from.value && to.value) {
			qs.set("from", from.value)
			qs.set("to", to.value)
		}
		rows.value = await api("/journal?" + qs)
	} finally {
		loading.value = false
	}
}
onMounted(async () => {
	hotels.value = await api("/hotels")
	await load()
})
</script>

<template>
	<div class="grid">
		<PageHeader title="Журнал размещений" subtitle="Все заселения · фильтры и поиск" icon="book" />

		<FilterBar>
			<Field label="Поиск (ФИО или номер)" style="flex: 1; min-width: 200px"><Input v-model="q" placeholder="Поиск…" @input="onSearch" /></Field>
			<Field label="Гостиница"><Select v-model="hotelId" @change="load"><option value="">Все</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select></Field>
			<Field label="С"><Input v-model="from" type="date" @change="load" /></Field>
			<Field label="По"><Input v-model="to" type="date" @change="load" /></Field>
		</FilterBar>

		<DataTable :columns="columns" :rows="rows" :loading="loading" empty-title="Размещений не найдено" empty-icon="book">
			<template #cell-resident_name="{ value }">{{ value || "—" }}</template>
			<template #cell-stage="{ row }"><StatusDot :color="row.status_color" /> {{ stageLabel[row.stage] }}</template>
		</DataTable>
	</div>
</template>
