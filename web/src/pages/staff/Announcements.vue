<script setup>
import { dateTime as fmt } from "@/utils/date"
import { ref, onMounted } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Button, IconButton, Drawer, Field, Input, Textarea, Select, Switch, EmptyState, Skeleton, Chip, confirm } from "@/ui"

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
			<Card v-for="(a, i) in items" :key="a.id" pad="lg" class="k-rise" :style="{ '--i': i }">
				<template #title>
					<h3 class="ann-title"><Icon v-if="a.pinned" name="pin" class="ann-pin" />{{ a.title }}</h3>
					<div class="ann-meta">
						<Chip :color="a.hotel_name ? 'var(--color-blue)' : 'var(--color-brand)'">{{ a.hotel_name || "Все гостиницы" }}</Chip>
						<span>{{ fmt(a.created_at) }}<template v-if="a.author"> · {{ a.author }}</template></span>
					</div>
				</template>
				<template #actions>
					<IconButton icon="pencil" label="Изменить" size="sm" @click="open(a)" />
					<IconButton icon="trash" label="Удалить" size="sm" variant="danger" @click="remove(a)" />
				</template>
				<p class="ann-body">{{ a.body }}</p>
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
.ann-title {
	font-size: var(--font-size-lg);
	line-height: 1.3;
}
.ann-pin {
	color: var(--color-brand);
	margin-right: 6px;
}
.ann-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px var(--gap-sm);
	margin-top: 6px;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.ann-body {
	margin: 0;
	white-space: pre-wrap;
}
.ann-grid {
	display: grid;
	/* auto-fit: карточки растягиваются на ширину, а не жмутся влево */
	grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
	gap: var(--gap-md);
	align-items: start;
}
</style>
