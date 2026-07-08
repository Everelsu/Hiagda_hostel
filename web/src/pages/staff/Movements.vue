<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"
import { PageHeader, DataTable, StatusDot, Chip, Input } from "@/ui"

const date = ref(new Date().toISOString().slice(0, 10))
const data = ref(null)
const loading = ref(true)
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
const columns = [
	{ key: "resident_name", label: "Проживающий" },
	{ key: "hotel_name", label: "Размещение" },
	{ key: "stage", label: "Стадия", align: "right" },
]

async function load() {
	loading.value = true
	try {
		data.value = await api("/movements?date=" + date.value)
	} finally {
		loading.value = false
	}
}
onMounted(load)
</script>

<template>
	<div class="grid">
		<PageHeader title="Заезды / выезды" subtitle="Кто заселяется и выезжает в выбранную дату" icon="key">
			<template #actions><Input v-model="date" type="date" @change="load" style="width: auto" /></template>
		</PageHeader>

		<div class="cols">
			<section>
				<div class="section-title">Заезды <span class="muted" style="font-weight: 400">({{ data?.arrivals.length || 0 }})</span></div>
				<DataTable :columns="columns" :rows="data?.arrivals || []" :loading="loading" row-key="id" empty-title="Нет заездов" empty-icon="key">
					<template #cell-resident_name="{ row }"><StatusDot :color="row.status_color" /> <b class="contrast">{{ row.resident_name || "—" }}</b></template>
					<template #cell-hotel_name="{ row }"><span class="muted">{{ row.hotel_name }} · № {{ row.room_number }} · {{ row.bed_label }}</span></template>
					<template #cell-stage="{ row }"><Chip>{{ stageLabel[row.stage] }}</Chip></template>
				</DataTable>
			</section>
			<section>
				<div class="section-title">Выезды <span class="muted" style="font-weight: 400">({{ data?.departures.length || 0 }})</span></div>
				<DataTable :columns="columns" :rows="data?.departures || []" :loading="loading" row-key="id" empty-title="Нет выездов" empty-icon="key">
					<template #cell-resident_name="{ row }"><StatusDot :color="row.status_color" /> <b class="contrast">{{ row.resident_name || "—" }}</b></template>
					<template #cell-hotel_name="{ row }"><span class="muted">{{ row.hotel_name }} · № {{ row.room_number }} · {{ row.bed_label }}</span></template>
					<template #cell-stage="{ row }"><Chip>{{ stageLabel[row.stage] }}</Chip></template>
				</DataTable>
			</section>
		</div>
	</div>
</template>

<style scoped>
.cols {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-lg);
	align-items: start;
}
@media (max-width: 860px) {
	.cols {
		grid-template-columns: 1fr;
	}
}
</style>
