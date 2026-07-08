<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"
import { PageHeader, DataTable } from "@/ui"

const rows = ref([])
const loading = ref(true)
const columns = [
	{ key: "created_at", label: "Когда", sortable: true },
	{ key: "username", label: "Пользователь", sortable: true },
	{ key: "summary", label: "Действие" },
	{ key: "path", label: "Метод · путь" },
]

onMounted(async () => {
	try {
		rows.value = await api("/audit?limit=200")
	} finally {
		loading.value = false
	}
})
</script>

<template>
	<div class="grid">
		<PageHeader title="Журнал действий" subtitle="Кто и что менял в системе" icon="info" />
		<DataTable :columns="columns" :rows="rows" :loading="loading" empty-title="Записей нет">
			<template #cell-created_at="{ value }"><span class="muted">{{ value }}</span></template>
			<template #cell-username="{ value }">{{ value || "—" }}</template>
			<template #cell-path="{ row }"><span class="muted">{{ row.method }} {{ row.path }}</span></template>
		</DataTable>
	</div>
</template>
