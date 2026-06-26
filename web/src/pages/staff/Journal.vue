<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"

const hotels = ref([])
const q = ref("")
const hotelId = ref("")
const from = ref("")
const to = ref("")
const rows = ref([])
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }

let timer
function onSearch() {
	clearTimeout(timer)
	timer = setTimeout(load, 250)
}
async function load() {
	const qs = new URLSearchParams()
	if (q.value) qs.set("q", q.value)
	if (hotelId.value) qs.set("hotel_id", hotelId.value)
	if (from.value && to.value) {
		qs.set("from", from.value)
		qs.set("to", to.value)
	}
	rows.value = await api("/journal?" + qs)
}
onMounted(async () => {
	hotels.value = await api("/hotels")
	await load()
})
</script>

<template>
	<div class="grid">
		<div>
			<h1>Журнал размещений</h1>
			<p class="muted" style="margin-top: 2px">Все заселения · фильтры и поиск</p>
		</div>

		<div class="card row wrap" style="align-items: flex-end">
			<div class="field grow" style="margin: 0; min-width: 180px"><label>Поиск (ФИО или номер)</label><input v-model="q" placeholder="Поиск…" @input="onSearch" /></div>
			<div class="field" style="margin: 0"><label>Гостиница</label><select v-model="hotelId" style="width: auto" @change="load"><option value="">Все</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></select></div>
			<div class="field" style="margin: 0"><label>С</label><input v-model="from" type="date" style="width: auto" @change="load" /></div>
			<div class="field" style="margin: 0"><label>По</label><input v-model="to" type="date" style="width: auto" @change="load" /></div>
		</div>

		<div class="card">
			<p v-if="!rows.length" class="muted">Размещений не найдено.</p>
			<div v-else class="table-scroll">
				<table class="dt">
					<thead><tr><th>Гость</th><th>Гостиница</th><th>Номер</th><th>Место</th><th>Заезд</th><th>Выезд</th><th>Статус</th><th>Стадия</th></tr></thead>
					<tbody>
						<tr v-for="r in rows" :key="r.id">
							<td>{{ r.resident_name || "—" }}</td><td>{{ r.hotel_name }}</td><td>{{ r.room_number }}</td><td>{{ r.bed_label }}</td>
							<td>{{ r.date_from }}</td><td>{{ r.date_to }}</td>
							<td><span class="dot" :style="{ background: r.status_color }" /> {{ r.status_name }}</td>
							<td>{{ stageLabel[r.stage] }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>

<style scoped>
.table-scroll {
	overflow-x: auto;
}
.dt {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--font-size-sm);
}
.dt th,
.dt td {
	text-align: left;
	padding: var(--gap-xs) var(--gap-sm);
	border-bottom: 1px solid var(--color-divider);
	white-space: nowrap;
}
.dt .dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: var(--radius-max);
	margin-right: 4px;
}
</style>
