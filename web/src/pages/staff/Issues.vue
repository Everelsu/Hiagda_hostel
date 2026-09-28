<script setup>
import { dateTime as fmt } from "@/utils/date"
import { ref, onMounted, computed } from "vue"
import { api, put } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import IssueThread from "@/components/IssueThread.vue"
import { PageHeader, FilterBar, Select, DataTable, Drawer, Button, Chip, StatusDot, SegmentedControl } from "@/ui"

const items = ref([])
const hotels = ref([])
const loading = ref(true)
const fStatus = ref("")
const fHotel = ref("")
const active = ref(null)

const STATUSES = ["Новая", "В работе", "Починено"]
const STATUS_COLOR = { Новая: "var(--color-red)", "В работе": "var(--color-orange)", Починено: "var(--color-green)" }
const columns = [
	{ key: "hotel_name", label: "Размещение", sortable: true },
	{ key: "comment", label: "Проблема" },
	{ key: "created_at", label: "Подана", sortable: true },
	{ key: "status", label: "Статус" },
]

async function load() {
	loading.value = true
	try {
		const qs = new URLSearchParams()
		if (fStatus.value) qs.set("status", fStatus.value)
		if (fHotel.value) qs.set("hotel_id", fHotel.value)
		items.value = await api("/issues" + (qs.toString() ? "?" + qs : ""))
	} finally {
		loading.value = false
	}
}
onMounted(async () => {
	hotels.value = await api("/hotels")
	await load()
})

const counts = computed(() => {
	const c = { Новая: 0, "В работе": 0, Починено: 0 }
	for (const i of items.value) c[i.status] = (c[i.status] || 0) + 1
	return c
})
const statusOptions = computed(() => [
	{ value: "", label: "Все" },
	{ value: "Новая", label: "Новые", count: counts.value["Новая"] },
	{ value: "В работе", label: "В работе", count: counts.value["В работе"] },
	{ value: "Починено", label: "Готово", count: counts.value["Починено"] },
])

async function setStatus(issue, status) {
	try {
		await put("/issues/" + issue.id + "/status", { status })
		issue.status = status
		if (active.value?.id === issue.id) active.value.status = status
		toast.success("Статус: " + status)
	} catch (e) {
		toast.error(e.message)
	}
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Заявки на ремонт" icon="wrench" />

		<div class="row wrap" style="gap: var(--gap-md); align-items: flex-end">
			<SegmentedControl v-model="fStatus" :options="statusOptions" @update:model-value="load" />
			<FilterBar>
				<Select v-model="fHotel" style="width: auto" title="Гостиница" @change="load"><option value="">Все гостиницы</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select>
			</FilterBar>
		</div>

		<DataTable :columns="columns" :rows="items" :loading="loading" @row-click="active = { ...$event }" empty-title="Заявок нет — всё исправно" empty-icon="check">
			<template #cell-hotel_name="{ row }">
				<div class="contrast" style="font-weight: 700">{{ row.hotel_name }} · № {{ row.room_number }}</div>
				<div v-if="row.amenity_name" class="muted" style="font-size: var(--font-size-xs)">{{ row.amenity_name }}</div>
			</template>
			<template #cell-comment="{ row }">
				<span>{{ row.comment }}</span>
				<span v-if="row.comments_count" class="muted" style="font-size: var(--font-size-xs)"> · <Icon name="message-square" size="0.85em" /> {{ row.comments_count }}</span>
			</template>
			<template #cell-created_at="{ row }"><span class="muted" style="font-size: var(--font-size-xs)">{{ row.user_name || "—" }}<br />{{ fmt(row.created_at) }}</span></template>
			<template #cell-status="{ value }"><Chip :color="STATUS_COLOR[value]" dot>{{ value }}</Chip></template>
		</DataTable>

		<Drawer v-if="active" :title="`Заявка · ${active.hotel_name} № ${active.room_number}`" width="520px" @close="active = null">
			<div v-if="active.amenity_name" class="muted" style="font-size: var(--font-size-sm)">Объект: <b class="contrast">{{ active.amenity_name }}</b></div>
			<p style="margin: var(--gap-sm) 0 0; white-space: pre-wrap">{{ active.comment }}</p>
			<img v-if="active.photo" :src="active.photo" alt="фото заявки" class="issue-photo" />
			<div style="margin-top: var(--gap-md)">
				<label style="font-size: var(--font-size-xs); color: var(--color-secondary)">Статус</label>
				<div class="row wrap" style="gap: var(--gap-xs); margin-top: var(--gap-xs)">
					<Button v-for="s in STATUSES" :key="s" size="sm" :variant="active.status === s ? 'primary' : 'default'" @click="setStatus(active, s)">{{ s }}</Button>
				</div>
			</div>
			<div style="margin-top: var(--gap-md)">
				<label style="font-size: var(--font-size-xs); color: var(--color-secondary)">Переписка</label>
				<IssueThread :issue-id="active.id" />
			</div>
		</Drawer>
	</div>
</template>

<style scoped>
.issue-photo {
	max-width: 100%;
	border-radius: var(--radius-md);
	border: 1px solid var(--color-divider);
	margin-top: var(--gap-sm);
}
</style>
