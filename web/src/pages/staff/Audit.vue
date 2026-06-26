<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"

const rows = ref([])
onMounted(async () => {
	rows.value = await api("/audit?limit=200")
})
</script>

<template>
	<div class="grid">
		<div>
			<h1>Журнал действий</h1>
			<p class="muted" style="margin-top: 2px">Кто и что менял в системе</p>
		</div>
		<div class="card">
			<p v-if="!rows.length" class="muted">Записей нет.</p>
			<div v-else class="table-scroll">
				<table class="dt">
					<thead><tr><th>Когда</th><th>Пользователь</th><th>Действие</th><th>Метод · путь</th></tr></thead>
					<tbody>
						<tr v-for="r in rows" :key="r.id">
							<td class="muted">{{ r.created_at }}</td>
							<td>{{ r.username || "—" }}</td>
							<td>{{ r.summary }}</td>
							<td class="muted">{{ r.method }} {{ r.path }}</td>
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
</style>
