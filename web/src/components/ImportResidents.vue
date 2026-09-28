<script setup>
// Импорт кадровой выгрузки в два шага: сначала показываем, что будет сделано
// (ничего не записывая), и только по кнопке — загружаем.
import { ref, computed } from "vue"
import { api } from "@/api/client"
import { toast } from "@/toast"
import Modal from "@/components/Modal.vue"
import Icon from "@/components/Icon.vue"
import { Button, Chip, SegmentedControl } from "@/ui"

const emit = defineEmits(["close", "done"])

const file = ref(null)
const preview = ref(null)
const busy = ref(false)
const over = ref(false)
const tab = ref("new")
const input = ref(null)

async function send(dry) {
	const fd = new FormData()
	fd.append("file", file.value)
	return api("/import/residents" + (dry ? "?dry=1" : ""), { method: "POST", body: fd })
}
async function choose(f) {
	if (!f) return
	if (!/\.xlsx$/i.test(f.name)) return toast.error("Нужен файл Excel .xlsx (старый .xls сохраните как .xlsx)")
	file.value = f
	busy.value = true
	try {
		preview.value = await send(true)
		tab.value = preview.value.imported ? "new" : preview.value.updated ? "update" : "skip"
	} catch (e) {
		toast.error(e.message)
		file.value = null
	} finally {
		busy.value = false
	}
}
function onDrop(e) {
	over.value = false
	choose(e.dataTransfer.files?.[0])
}
async function apply() {
	busy.value = true
	try {
		const r = await send(false)
		toast.success(`Готово: добавлено ${r.imported}, обновлено ${r.updated}`)
		emit("done", r)
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}

const tabs = computed(() => {
	const p = preview.value
	if (!p) return []
	return [
		{ value: "new", label: "Новые", count: p.imported },
		{ value: "update", label: "Изменятся", count: p.updated },
		{ value: "same", label: "Без изменений", count: p.same },
		{ value: "skip", label: "Пропущены", count: p.skipped },
	]
})
const list = computed(() => (preview.value?.plan || []).filter((p) => p.action === tab.value))
const LIMIT = 200
const toWrite = computed(() => (preview.value ? preview.value.imported + preview.value.updated : 0))
</script>

<template>
	<Modal :title="preview ? `Импорт: ${file?.name}` : 'Импорт работников из Excel'" wide @close="emit('close')">
		<!-- Шаг 1: файл -->
		<template v-if="!preview">
			<label
				class="drop"
				:class="{ over, busy }"
				@dragover.prevent="over = true"
				@dragleave="over = false"
				@drop.prevent="onDrop"
			>
				<input ref="input" type="file" accept=".xlsx" hidden @change="choose($event.target.files[0])" />
				<span class="drop__ic"><Icon :name="busy ? 'rotate-cw' : 'upload'" size="1.6rem" :class="{ spin: busy }" /></span>
				<b>{{ busy ? "Разбираем файл…" : "Перетащите файл сюда или нажмите, чтобы выбрать" }}</b>
				<span class="muted">Excel (.xlsx) — выгрузка по работникам из 1С или любая таблица со списком людей</span>
			</label>
			<div class="how">
				<div class="how__item"><Icon name="check" /> Колонки находятся сами: ФИО, Таб. №, Должность, Подразделение, Организация, Телефон — названия могут отличаться</div>
				<div class="how__item"><Icon name="check" /> Уже известные люди обновляются по табельному номеру, без него — по ФИО. Дублей не будет</div>
				<div class="how__item"><Icon name="check" /> Пустые ячейки не затирают телефоны и заметки, введённые вручную</div>
				<div class="how__item"><Icon name="shield-check" /> Сначала покажем, что изменится, — в базу ничего не попадёт без вашего подтверждения</div>
			</div>
		</template>

		<!-- Шаг 2: предпросмотр -->
		<template v-else>
			<div class="sum">
				<div class="sum__i new"><b>{{ preview.imported }}</b><span>новых</span></div>
				<div class="sum__i upd"><b>{{ preview.updated }}</b><span>обновится</span></div>
				<div class="sum__i same"><b>{{ preview.same }}</b><span>без изменений</span></div>
				<div class="sum__i skip"><b>{{ preview.skipped }}</b><span>пропущено</span></div>
			</div>

			<div class="cols">
				<span class="muted">Что где нашли:</span>
				<template v-for="(v, k) in preview.columns" :key="k">
					<Chip v-if="v" :color="'var(--color-green)'">{{ k }} ← «{{ v }}»</Chip>
					<Chip v-else color="var(--color-gray)">{{ k }} — нет</Chip>
				</template>
			</div>

			<SegmentedControl v-model="tab" :options="tabs" />

			<div class="list">
				<p v-if="!list.length" class="muted empty">Здесь пусто</p>
				<div v-for="p in list.slice(0, LIMIT)" :key="p.line" class="li">
					<span class="li__line">стр. {{ p.line }}</span>
					<div class="grow">
						<div class="li__name">{{ p.name }} <span v-if="p.tab" class="muted">· {{ p.tab }}</span></div>
						<div v-if="p.action === 'new'" class="li__sub">{{ [p.position, p.department].filter(Boolean).join(" · ") || "—" }}</div>
						<div v-else-if="p.action === 'update'" class="li__changes">
							<span v-for="c in p.changes" :key="c.field" class="chg">
								<b>{{ c.field }}:</b> <s v-if="c.from">{{ c.from }}</s> <Icon name="arrow-right" size="0.8em" /> {{ c.to }}
							</span>
						</div>
						<div v-else-if="p.action === 'skip'" class="li__sub warn">{{ p.reason }}</div>
					</div>
				</div>
				<p v-if="list.length > LIMIT" class="muted empty">…и ещё {{ list.length - LIMIT }}</p>
			</div>
		</template>

		<template #foot>
			<Button v-if="preview" variant="ghost" icon="chevron-left" @click="preview = null; file = null">Другой файл</Button>
			<span class="grow" />
			<Button variant="ghost" @click="emit('close')">Отмена</Button>
			<Button v-if="preview" variant="primary" icon="check" :loading="busy" :disabled="!toWrite" @click="apply">
				{{ toWrite ? `Загрузить (${toWrite})` : "Нечего загружать" }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.drop {
	display: grid;
	justify-items: center;
	gap: 6px;
	padding: var(--gap-xl) var(--gap-lg);
	border: 2px dashed var(--color-button-border);
	border-radius: var(--radius-lg);
	text-align: center;
	cursor: pointer;
	transition: border-color var(--speed-fast), background var(--speed-fast);
}
.drop:hover,
.drop.over {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.drop.busy {
	pointer-events: none;
}
.drop b {
	color: var(--color-contrast);
}
.drop .muted {
	font-size: var(--font-size-sm);
}
.drop__ic {
	display: grid;
	place-items: center;
	width: 3.2rem;
	height: 3.2rem;
	border-radius: 50%;
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	margin-bottom: 4px;
}
.spin {
	animation: spin 0.8s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.how {
	display: grid;
	gap: 6px;
	margin-top: var(--gap-lg);
	font-size: var(--font-size-sm);
}
.how__item {
	display: flex;
	gap: var(--gap-sm);
	align-items: flex-start;
}
.how__item :deep(svg) {
	color: var(--color-green);
	margin-top: 3px;
}
.sum {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: var(--gap-sm);
}
.sum__i {
	display: grid;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-bg);
}
.sum__i b {
	font-size: 1.5rem;
	line-height: 1.1;
	color: var(--color-contrast);
}
.sum__i span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.sum__i.new b {
	color: var(--color-green);
}
.sum__i.upd b {
	color: var(--color-blue);
}
.sum__i.skip b {
	color: var(--color-orange);
}
.cols {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
	margin: var(--gap-md) 0;
	font-size: var(--font-size-xs);
}
.list {
	margin-top: var(--gap-sm);
	max-height: 42vh;
	overflow-y: auto;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.empty {
	padding: var(--gap-md);
	text-align: center;
	font-size: var(--font-size-sm);
	margin: 0;
}
.li {
	display: flex;
	gap: var(--gap-md);
	padding: var(--gap-sm) var(--gap-md);
	border-bottom: 1px solid var(--color-divider);
	font-size: var(--font-size-sm);
}
.li:last-child {
	border-bottom: none;
}
.li__line {
	flex-shrink: 0;
	width: 3.8rem;
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
	padding-top: 2px;
}
.li__name {
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
}
.li__sub {
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.li__sub.warn {
	color: var(--color-orange);
}
.li__changes {
	display: grid;
	gap: 2px;
	font-size: var(--font-size-xs);
}
.chg s {
	color: var(--color-secondary);
}
.grow {
	flex: 1;
	min-width: 0;
}
@media (max-width: 560px) {
	.sum {
		grid-template-columns: repeat(2, 1fr);
	}
}
</style>
