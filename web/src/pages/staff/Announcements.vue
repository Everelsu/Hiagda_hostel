<script setup>
import { ref, onMounted } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Button, IconButton, Drawer, Field, Input, Textarea, Select, Switch, EmptyState, Skeleton, confirm } from "@/ui"

const items = ref([])
const hotels = ref([])
const loading = ref(true)
const editing = ref(null)
const busy = ref(false)

const blank = () => ({ id: null, hotel_id: "", title: "", body: "", pinned: false })

async function load() {
	items.value = await api("/announcements")
}
onMounted(async () => {
	try {
		hotels.value = await api("/hotels")
		await load()
	} finally {
		loading.value = false
	}
})

function open(a) {
	editing.value = a ? { ...a, hotel_id: a.hotel_id ?? "", pinned: !!a.pinned } : blank()
}
async function save() {
	const e = editing.value
	if (!e.title.trim() || !e.body.trim()) return toast.error("Заполните заголовок и текст")
	busy.value = true
	try {
		const payload = { hotel_id: e.hotel_id || null, title: e.title.trim(), body: e.body.trim(), pinned: e.pinned }
		if (e.id) await put("/announcements/" + e.id, payload)
		else await post("/announcements", payload)
		editing.value = null
		toast.success("Сохранено")
		load()
	} catch (err) {
		toast.error(err.message)
	} finally {
		busy.value = false
	}
}
async function remove(a) {
	if (!(await confirm({ title: "Удалить объявление?", danger: true, confirmLabel: "Удалить" }))) return
	try {
		await del("/announcements/" + a.id)
		load()
	} catch (e) {
		toast.error(e.message)
	}
}
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : ""
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Объявления" icon="megaphone">
			<template #actions><Button variant="primary" icon="plus" @click="open(null)">Новое</Button></template>
		</PageHeader>

		<Skeleton v-if="loading" variant="card" :count="2" />
		<Card v-else-if="!items.length">
			<EmptyState icon="megaphone" title="Объявлений пока нет" text="Опубликуйте первое — его увидят вахтовики в своём кабинете." />
		</Card>
		<div v-else class="ann-grid">
			<Card v-for="a in items" :key="a.id" pad="lg">
				<template #actions>
					<IconButton icon="pencil" label="Изменить" @click="open(a)" />
					<IconButton icon="trash" label="Удалить" variant="danger" @click="remove(a)" />
				</template>
				<div class="row" style="gap: var(--gap-sm)">
					<Icon v-if="a.pinned" name="pin" style="color: var(--color-brand)" />
					<span class="contrast" style="font-weight: 700; font-size: var(--font-size-lg)">{{ a.title }}</span>
				</div>
				<div class="muted" style="font-size: var(--font-size-xs); margin-top: 2px">
					{{ a.hotel_name || "Все гостиницы" }} · {{ fmt(a.created_at) }}<template v-if="a.author"> · {{ a.author }}</template>
				</div>
				<p style="margin: var(--gap-sm) 0 0; white-space: pre-wrap">{{ a.body }}</p>
			</Card>
		</div>

		<Drawer v-if="editing" :title="editing.id ? 'Изменить объявление' : 'Новое объявление'" @close="editing = null">
			<Field label="Куда">
				<Select v-model="editing.hotel_id">
					<option value="">Все гостиницы</option>
					<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
				</Select>
			</Field>
			<Field label="Заголовок"><Input v-model="editing.title" placeholder="Например: Плановое отключение воды" /></Field>
			<Field label="Текст"><Textarea v-model="editing.body" :rows="5" /></Field>
			<Switch v-model="editing.pinned" label="Закрепить вверху" />
			<template #foot>
				<Button variant="ghost" @click="editing = null">Отмена</Button>
				<Button variant="primary" :loading="busy" @click="save">Сохранить</Button>
			</template>
		</Drawer>
	</div>
</template>

<style scoped>
.ann-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
	gap: var(--gap-md);
	align-items: start;
}
</style>
