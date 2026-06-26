<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"

const date = ref(new Date().toISOString().slice(0, 10))
const data = ref(null)
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }

async function load() {
	data.value = await api("/movements?date=" + date.value)
}
onMounted(load)
</script>

<template>
	<div class="grid">
		<div class="spread">
			<div>
				<h1>Заезды / выезды</h1>
				<p class="muted" style="margin-top: 2px">Кто заселяется и выезжает в выбранную дату</p>
			</div>
			<input v-model="date" type="date" style="width: auto" @change="load" />
		</div>

		<div v-if="data" class="cols">
			<div class="card">
				<div class="section-title">Заезды <span class="muted" style="font-weight: 400">({{ data.arrivals.length }})</span></div>
				<p v-if="!data.arrivals.length" class="muted">Нет записей.</p>
				<div v-for="(r, i) in data.arrivals" :key="i" class="mrow">
					<span class="dot" :style="{ background: r.status_color }" />
					<div class="grow">
						<div class="contrast" style="font-weight: 700">{{ r.resident_name || "—" }}</div>
						<div class="muted" style="font-size: var(--font-size-sm)">{{ r.hotel_name }} · № {{ r.room_number }} · {{ r.bed_label }}</div>
					</div>
					<span class="chip">{{ stageLabel[r.stage] }}</span>
				</div>
			</div>
			<div class="card">
				<div class="section-title">Выезды <span class="muted" style="font-weight: 400">({{ data.departures.length }})</span></div>
				<p v-if="!data.departures.length" class="muted">Нет записей.</p>
				<div v-for="(r, i) in data.departures" :key="i" class="mrow">
					<span class="dot" :style="{ background: r.status_color }" />
					<div class="grow">
						<div class="contrast" style="font-weight: 700">{{ r.resident_name || "—" }}</div>
						<div class="muted" style="font-size: var(--font-size-sm)">{{ r.hotel_name }} · № {{ r.room_number }} · {{ r.bed_label }}</div>
					</div>
					<span class="chip">{{ stageLabel[r.stage] }}</span>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.cols {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-lg);
}
.mrow {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	margin-bottom: var(--gap-sm);
}
.mrow .dot {
	width: 12px;
	height: 12px;
	border-radius: var(--radius-max);
	flex-shrink: 0;
}
@media (max-width: 800px) {
	.cols {
		grid-template-columns: 1fr;
	}
}
</style>
