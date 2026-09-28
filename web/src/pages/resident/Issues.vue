<script setup>
import { dateTime as fmt } from "@/utils/date"
import { ref, onMounted } from "vue"
import { api, post, uploadFile } from "@/api/client"
import { toast } from "@/toast"
import { useOverview, loadFeed } from "@/api/me"
import Icon from "@/components/Icon.vue"
import IssueThread from "@/components/IssueThread.vue"
import { amenityIcon } from "@/icons"
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

// Частые формулировки — в одно касание, печатать на телефоне неудобно
const QUICK = ["Не работает", "Протекает", "Нет горячей воды", "Сломано", "Не закрывается", "Шумит", "Нет света"]
function addQuick(t) {
	const c = form.value.comment.trim()
	form.value.comment = c ? `${c}. ${t.toLowerCase()}` : t
}
function pickAmenity(name) {
	form.value.amenity_name = form.value.amenity_name === name ? "" : name
}

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
			<div v-if="overview?.room?.amenities?.length" class="step">
				<div class="step__label">Что сломалось? <span class="muted">— можно не выбирать</span></div>
				<div class="tiles">
					<button
						v-for="a in overview.room.amenities"
						:key="a.name"
						type="button"
						class="tile"
						:class="{ on: form.amenity_name === a.name }"
						@click="pickAmenity(a.name)"
					>
						<Icon :name="amenityIcon(a.icon)" size="1.3rem" />
						<span>{{ a.name }}</span>
					</button>
				</div>
			</div>
			<div class="step">
				<div class="step__label">Что случилось?</div>
				<div class="quick">
					<button v-for="q in QUICK" :key="q" type="button" class="quick__chip" @click="addQuick(q)">{{ q }}</button>
				</div>
				<Textarea v-model="form.comment" :rows="3" placeholder="Коротко: что и где. Например, не работает розетка у кровати" />
			</div>
			<div class="step">
				<div class="step__label">Фото <span class="muted">— коменданту так проще понять</span></div>
				<label v-if="!form.photo" class="shot" :class="{ busy: uploading }">
					<input type="file" accept="image/*" capture="environment" hidden @change="onFile" />
					<Icon :name="uploading ? 'rotate-cw' : 'camera'" size="1.5rem" />
					<span>{{ uploading ? "Загружаем фото…" : "Сфотографировать или выбрать" }}</span>
				</label>
				<div v-else class="shot-preview">
					<img :src="form.photo" alt="фото" />
					<button type="button" class="shot-preview__x" aria-label="Убрать фото" @click="form.photo = ''"><Icon name="x" /></button>
				</div>
			</div>
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
.step {
	display: grid;
	gap: var(--gap-sm);
}
.step__label {
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.step__label .muted {
	font-weight: 400;
}
.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
	gap: var(--gap-sm);
}
.tile {
	display: grid;
	justify-items: center;
	gap: 6px;
	padding: var(--gap-md) var(--gap-sm);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	text-align: center;
	cursor: pointer;
}
.tile :deep(svg) {
	color: var(--color-brand);
}
.tile.on {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
	color: var(--color-contrast);
}
.quick {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.quick__chip {
	padding: 6px 12px;
	border: 1px solid var(--color-button-border);
	border-radius: var(--radius-max);
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	cursor: pointer;
}
.quick__chip:active {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
}
.shot {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--gap-sm);
	min-height: 5rem;
	border: 2px dashed var(--color-button-border);
	border-radius: var(--radius-lg);
	color: var(--color-secondary);
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	cursor: pointer;
}
.shot :deep(svg) {
	color: var(--color-brand);
}
.shot.busy {
	pointer-events: none;
	opacity: 0.7;
}
.shot-preview {
	position: relative;
}
.shot-preview img {
	width: 100%;
	max-height: 260px;
	object-fit: cover;
	border-radius: var(--radius-lg);
	display: block;
}
.shot-preview__x {
	position: absolute;
	top: 8px;
	right: 8px;
	width: 2.2rem;
	height: 2.2rem;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.6);
	color: #fff;
	cursor: pointer;
}
.preview {
	max-width: 100%;
	border-radius: var(--radius-md);
	border: 1px solid var(--color-divider);
	margin-top: var(--gap-sm);
}
</style>
