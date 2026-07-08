<script setup>
import { ref, onMounted } from "vue"
import { api, post, uploadFile } from "@/api/client"
import { toast } from "@/toast"
import { useOverview, loadFeed } from "@/api/me"
import Icon from "@/components/Icon.vue"
import IssueThread from "@/components/IssueThread.vue"
import { PageHeader, Card, ListRow, Chip, StatusDot, Drawer, Field, Select, Textarea, Button, EmptyState } from "@/ui"

const { overview, load } = useOverview()
const issues = ref([])
const loading = ref(true)
const active = ref(null)
const creating = ref(false)
const form = ref({ amenity_name: "", comment: "", photo: "" })
const busy = ref(false)
const uploading = ref(false)

const STATUS_COLOR = { Новая: "var(--color-red)", "В работе": "var(--color-orange)", Починено: "var(--color-green)" }

async function loadIssues() {
	issues.value = await api("/me/issues")
}
onMounted(async () => {
	try {
		await load()
		await loadIssues()
	} finally {
		loading.value = false
	}
})

function openNew() {
	form.value = { amenity_name: "", comment: "", photo: "" }
	creating.value = true
}
async function onFile(e) {
	const file = e.target.files?.[0]
	if (!file) return
	uploading.value = true
	try {
		form.value.photo = await uploadFile(file)
	} catch (err) {
		toast.error(err.message)
	} finally {
		uploading.value = false
	}
}
async function submit() {
	if (!overview.value?.room?.id) return toast.error("Нет активного размещения")
	if (!form.value.comment.trim()) return toast.error("Опишите проблему")
	busy.value = true
	try {
		await post("/me/issues", {
			room_id: overview.value.room.id,
			amenity_name: form.value.amenity_name || null,
			comment: form.value.comment.trim(),
			photo: form.value.photo || null,
		})
		creating.value = false
		toast.success("Заявка отправлена")
		await loadIssues()
		loadFeed(true).catch(() => {})
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : ""
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Заявки на ремонт" icon="wrench">
			<template #actions><Button variant="primary" icon="plus" :disabled="!overview?.room" @click="openNew">Новая</Button></template>
		</PageHeader>

		<Card v-if="loading"><EmptyState icon="wrench" text="Загрузка…" /></Card>
		<Card v-else-if="!issues.length"><EmptyState icon="wrench" title="Заявок пока нет" text="Что-то сломалось — нажмите «Новая»." /></Card>
		<div v-else class="grid" style="gap: var(--gap-sm)">
			<ListRow v-for="i in issues" :key="i.id" interactive @click="active = { ...i }">
				<template #lead><StatusDot :color="STATUS_COLOR[i.status]" size="12px" /></template>
				<template #title>{{ i.amenity_name || "Заявка" }} · № {{ i.room_number }}</template>
				<template #sub>
					{{ i.comment }}
					<span style="display: block; font-size: var(--font-size-xs)">{{ fmt(i.created_at) }}<template v-if="i.comments_count"> · <Icon name="message-square" size="0.85em" /> {{ i.comments_count }}</template></span>
				</template>
				<template #trail><Chip :color="STATUS_COLOR[i.status]" dot>{{ i.status }}</Chip></template>
			</ListRow>
		</div>

		<Drawer v-if="creating" title="Новая заявка на ремонт" @close="creating = false">
			<Field v-if="overview?.room?.amenities?.length" label="Что сломалось (необязательно)">
				<Select v-model="form.amenity_name">
					<option value="">— выбрать из удобств —</option>
					<option v-for="a in overview.room.amenities" :key="a.name" :value="a.name">{{ a.name }}</option>
				</Select>
			</Field>
			<Field label="Опишите проблему"><Textarea v-model="form.comment" :rows="4" placeholder="Например: не работает розетка у кровати" /></Field>
			<Field label="Фото (необязательно)">
				<input type="file" accept="image/*" @change="onFile" />
				<div v-if="uploading" class="muted" style="font-size: var(--font-size-xs); margin-top: 4px">Загрузка…</div>
				<img v-if="form.photo" :src="form.photo" alt="фото" class="preview" />
			</Field>
			<template #foot>
				<Button variant="ghost" @click="creating = false">Отмена</Button>
				<Button variant="primary" :loading="busy" :disabled="uploading" @click="submit">Отправить</Button>
			</template>
		</Drawer>

		<Drawer v-if="active" :title="`Заявка · № ${active.room_number}`" @close="active = null">
			<div class="row" style="gap: var(--gap-sm)">
				<Chip :color="STATUS_COLOR[active.status]" dot>{{ active.status }}</Chip>
				<span v-if="active.amenity_name" class="muted">{{ active.amenity_name }}</span>
			</div>
			<p style="margin: var(--gap-sm) 0 0; white-space: pre-wrap">{{ active.comment }}</p>
			<img v-if="active.photo" :src="active.photo" alt="фото заявки" class="preview" />
			<div style="margin-top: var(--gap-md)">
				<label style="font-size: var(--font-size-xs); color: var(--color-secondary)">Переписка с комендантом</label>
				<IssueThread :issue-id="active.id" />
			</div>
		</Drawer>
	</div>
</template>

<style scoped>
.preview {
	max-width: 100%;
	border-radius: var(--radius-md);
	border: 1px solid var(--color-divider);
	margin-top: var(--gap-sm);
}
</style>
