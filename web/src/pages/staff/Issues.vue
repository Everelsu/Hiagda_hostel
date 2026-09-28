<script setup>
import { dateTime as fmt } from "@/utils/date"
import { ref, onMounted, onUnmounted, computed } from "vue"
import { useRoute } from "vue-router"
import { api, put, del } from "@/api/client"
import { onRealtime } from "@/realtime"
import { useAuthStore } from "@/stores/auth"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import IssueThread from "@/components/IssueThread.vue"
import PhotoView from "@/components/PhotoView.vue"
import { PageHeader, FilterBar, Select, DataTable, Drawer, Button, Chip, StatusDot, SegmentedControl, confirm } from "@/ui"

const route = useRoute()
const auth = useAuthStore()
const canDelete = auth.can("editor")
const all = ref([])
const hotels = ref([])
const loading = ref(true)
const fStatus = ref("")
// С карты приходят сразу с нужным домом: /app/issues?hotel_id=1
const fHotel = ref(route.query.hotel_id ? String(route.query.hotel_id) : "")
const active = ref(null)

const STATUSES = ["Новая", "В работе", "Починено"]
const STATUS_COLOR = { Новая: "var(--color-red)", "В работе": "var(--color-orange)", Починено: "var(--color-green)" }
const columns = [
	{ key: "hotel_name", label: "Размещение", sortable: true },
	{ key: "comment", label: "Проблема" },
	{ key: "created_at", label: "Подана", sortable: true },
	{ key: "status", label: "Статус" },
]

// Грузим все заявки дома, а по статусу фильтруем на месте — тогда счётчики на кнопках
// честные для всех статусов, а не только для выбранного
async function load(quiet = false) {
	if (!quiet) loading.value = true
	try {
		all.value = await api("/issues" + (fHotel.value ? "?hotel_id=" + fHotel.value : ""))
		// открытая карточка — свежие статус и данные
		if (active.value) {
			const fresh = all.value.find((i) => i.id === active.value.id)
			if (fresh) active.value = { ...fresh }
		}
	} finally {
		loading.value = false
	}
}
const items = computed(() => (fStatus.value ? all.value.filter((i) => i.status === fStatus.value) : all.value))
onMounted(async () => {
	hotels.value = await api("/hotels")
	await load()
})

// Новые заявки, смена статуса, сообщения — список обновляется сам
let timer = 0
const stopRealtime = onRealtime((e) => {
	if (e.type !== "issues:changed" && e.type !== "issue:comment") return
	if (e.deleted && active.value?.id === e.issueId) active.value = null
	clearTimeout(timer)
	timer = setTimeout(() => load(true), 250)
})
onUnmounted(() => {
	stopRealtime()
	clearTimeout(timer)
})

async function removeIssue(issue) {
	const ok = await confirm({
		title: "Удалить заявку?",
		message: `«${issue.amenity_name || "Заявка"}» в № ${issue.room_number} пропадёт вместе с перепиской — и у вахтовика тоже. Для починенных лучше оставить статус «Починено».`,
		danger: true,
		confirmLabel: "Удалить заявку",
	})
	if (!ok) return
	try {
		await del("/issues/" + issue.id)
		active.value = null
		all.value = all.value.filter((i) => i.id !== issue.id)
		toast.success("Заявка удалена")
	} catch (e) {
		toast.error(e.message)
	}
}

const counts = computed(() => {
	const c = { Новая: 0, "В работе": 0, Починено: 0 }
	for (const i of all.value) c[i.status] = (c[i.status] || 0) + 1
	return c
})
const statusOptions = computed(() => [
	{ value: "", label: "Все", count: all.value.length },
	{ value: "Новая", label: "Новые", count: counts.value["Новая"] },
	{ value: "В работе", label: "В работе", count: counts.value["В работе"] },
	{ value: "Починено", label: "Готово", count: counts.value["Починено"] },
])

async function setStatus(issue, status) {
	try {
		await put("/issues/" + issue.id + "/status", { status })
		issue.status = status
		const row = all.value.find((i) => i.id === issue.id)
		if (row) row.status = status
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
			<SegmentedControl v-model="fStatus" :options="statusOptions" />
			<FilterBar>
				<Select v-model="fHotel" style="width: auto" title="Гостиница" @change="load()"><option value="">Все гостиницы</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></Select>
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
			<PhotoView v-if="active.photo" :src="active.photo" alt="Фото заявки" />
			<div style="margin-top: var(--gap-md)">
				<label style="font-size: var(--font-size-xs); color: var(--color-secondary)">Статус</label>
				<div class="row wrap" style="gap: var(--gap-xs); margin-top: var(--gap-xs)">
					<Button v-for="s in STATUSES" :key="s" size="sm" :variant="active.status === s ? 'primary' : 'default'" @click="setStatus(active, s)">{{ s }}</Button>
					<Button v-if="canDelete" size="sm" variant="ghost" icon="trash" class="del-btn" @click="removeIssue(active)">Удалить</Button>
				</div>
			</div>
			<IssueThread :issue-id="active.id" :closed="active.status === 'Починено'" closed-hint="Заявка закрыта. Чтобы написать, верните её «В работу» кнопкой выше." />
		</Drawer>
	</div>
</template>

<style scoped>
.del-btn {
	margin-left: auto;
	color: var(--color-red);
}
</style>
