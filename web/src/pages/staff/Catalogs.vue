<script setup>
/**
 * Справочники — три словаря, на которых держится вся система:
 * типы номеров, цветовые статусы брони и каталог удобств.
 * Добавление и правка — в одном окне: кнопка «+» в шапке или клик по плитке.
 */
import { ref, onMounted, computed, nextTick } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import Modal from "@/components/Modal.vue"
import { PageHeader, Card, Field, Input, Button, IconButton, Tabs, EmptyState, SegmentedControl, ColorPicker, confirm } from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")

const tab = ref("classes")
const classes = ref([])
const statuses = ref([])
const amenities = ref([])
const loading = ref(true)

const ICON_OPTIONS = [
	{ value: "wifi", label: "Wi-Fi" },
	{ value: "tv", label: "Телевизор" },
	{ value: "shower", label: "Душ / вода" },
	{ value: "fridge", label: "Холодильник" },
	{ value: "snow", label: "Кондиционер" },
	{ value: "utensils", label: "Питание" },
	{ value: "washer", label: "Стирка" },
	{ value: "wind", label: "Сушилка" },
	{ value: "dumbbell", label: "Спорт" },
	{ value: "sofa", label: "Мебель / отдых" },
	{ value: "dot", label: "Другое" },
]
const SCOPE = { both: "в номере и в доме", room: "в номере", hotel: "в доме" }
const SCOPE_OPTIONS = [
	{ value: "room", label: "В номере" },
	{ value: "hotel", label: "В доме" },
	{ value: "both", label: "И там, и там" },
]
const PRESET_COLORS = ["#5fc8ff", "#1bd96a", "#c78aff", "#ffd166", "#ff8a5c", "#ff496e", "#9fa4b3", "#3a3f47"]
// Привязка статуса к состоянию брони: при смене состояния лента сама перекрашивается
const STAGE_NAME = { expected: "Ожидается заезд", checked_in: "Проживает", checked_out: "Выехал" }
const STAGE_OPTIONS = [
	{ value: null, title: "Особая метка", text: "Выбирают в брони вручную, например «Командировка»" },
	{ value: "expected", title: "Ставится сам: Ожидается заезд", text: "Бронь оформлена, человек ещё не приехал" },
	{ value: "checked_in", title: "Ставится сам: Проживает", text: "После «Заселить»" },
	{ value: "checked_out", title: "Ставится сам: Выехал", text: "После «Выселить»" },
]
const SYSTEM_WHY = {
	free: "Место свободно — на нём нет брони",
	repair: "Номер на ремонте — ставится в календаре броней или в плане этажа",
}

const bookingStatuses = computed(() => statuses.value.filter((s) => s.kind !== "system"))
const systemStatuses = computed(() => statuses.value.filter((s) => s.kind === "system"))

const tabs = computed(() => [
	{ value: "classes", label: "Типы номеров", icon: "bed", count: classes.value.length },
	{ value: "statuses", label: "Статусы брони", icon: "tag", count: bookingStatuses.value.length },
	{ value: "amenities", label: "Удобства", icon: "armchair", count: amenities.value.length },
])
const ADD_LABEL = { classes: "Тип номера", statuses: "Статус", amenities: "Удобство" }

async function reload() {
	;[classes.value, statuses.value, amenities.value] = await Promise.all([api("/classes"), api("/statuses"), api("/amenities")])
}
onMounted(async () => {
	try {
		await reload()
	} finally {
		loading.value = false
	}
})

/* ---------- окно добавления / правки ---------- */
const form = ref(null) // { kind: class|status|amenity, id?, system?, ...поля }
const formError = ref("")
const saving = ref(false)
const nameEl = ref(null)

async function openForm(kind, item = null) {
	if (!canEdit) return
	formError.value = ""
	if (kind === "class") form.value = { kind, id: item?.id, name: item?.name || "" }
	if (kind === "status")
		form.value = {
			kind,
			id: item?.id,
			system: item?.kind === "system",
			code: item?.code,
			name: item?.name || "",
			color: item?.color || PRESET_COLORS[0],
			stage: item ? item.stage || null : null,
			sort: item?.sort ?? statuses.value.length,
		}
	if (kind === "amenity") form.value = { kind, id: item?.id, name: item?.name || "", icon: item?.icon || "dot", scope: item?.scope || "room" }
	await nextTick()
	nameEl.value?.focus()
}
const openAdd = () => openForm({ classes: "class", statuses: "status", amenities: "amenity" }[tab.value])
const formTitle = computed(() => {
	const f = form.value
	if (!f) return ""
	const what = { class: "тип номера", status: f.system ? "состояние" : "статус брони", amenity: "удобство" }[f.kind]
	return f.id ? `Изменить ${what}` : `Новый ${what}`.replace("Новый удобство", "Новое удобство")
})
// Какие стадии уже заняты другими статусами — показываем, что привязка переедет
const stageOwner = (stage) => bookingStatuses.value.find((s) => s.stage === stage && s.id !== form.value?.id)

async function saveForm() {
	const f = form.value
	if (!f.name.trim()) {
		formError.value = "Введите название"
		return nameEl.value?.focus()
	}
	saving.value = true
	formError.value = ""
	try {
		const name = f.name.trim()
		if (f.kind === "class") f.id ? await put("/classes/" + f.id, { name }) : await post("/classes", { name })
		if (f.kind === "status") {
			const body = { name, color: f.color, sort: f.sort, ...(f.system ? {} : { stage: f.stage || null }) }
			f.id ? await put("/statuses/" + f.id, body) : await post("/statuses", body)
		}
		if (f.kind === "amenity") {
			const body = { name, icon: f.icon, scope: f.scope }
			f.id ? await put("/amenities/" + f.id, body) : await post("/amenities", body)
		}
		toast.success(f.id ? "Сохранено" : `«${name}» добавлен${f.kind === "amenity" ? "о" : ""}`)
		form.value = null
		await reload()
	} catch (e) {
		// Ошибку показываем прямо в окне — тост легко не заметить
		formError.value = e.message
	} finally {
		saving.value = false
	}
}

async function remove(item, path, what) {
	const used = item.used_count || 0
	const message = used
		? `Запись используется ${used} раз. Удаление может нарушить связанные данные.`
		: "Запись нигде не используется — удалить безопасно."
	if (!(await confirm({ title: `Удалить «${item.name}»?`, message, danger: true, confirmLabel: "Удалить" }))) return
	try {
		await del(path + item.id)
		form.value = null
		await reload()
		toast.success(what + " удалён")
	} catch (e) {
		toast.error(e.message)
	}
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Справочники" subtitle="Словари, на которые опираются номера и брони" icon="tag">
			<template #actions>
				<Button v-if="canEdit" variant="primary" icon="plus" @click="openAdd">{{ ADD_LABEL[tab] }}</Button>
			</template>
		</PageHeader>

		<Tabs v-model="tab" :options="tabs" />

		<!-- ТИПЫ НОМЕРОВ -->
		<template v-if="tab === 'classes'">
			<p class="lead">Тип номера — категория вроде «Одноместный» или «Двухместный». По нему фильтруются календарь броней и поиск свободных мест.</p>
			<Card v-if="!loading && !classes.length">
				<EmptyState icon="bed" title="Типов пока нет" text="Добавьте первый — например «Одноместный».">
					<Button v-if="canEdit" variant="primary" icon="plus" @click="openForm('class')">Тип номера</Button>
				</EmptyState>
			</Card>
			<div v-else class="tiles">
				<button v-for="(c, i) in classes" :key="c.id" type="button" class="tile k-rise k-lift" :style="{ '--i': i }" :disabled="!canEdit" @click="openForm('class', c)">
					<span class="tile__ico"><Icon name="bed" /></span>
					<span class="tile__body">
						<span class="tile__name">{{ c.name }}</span>
						<span class="tile__sub">{{ c.used_count ? `${c.used_count} номеров` : "пока не используется" }}</span>
					</span>
					<Icon v-if="canEdit" name="pencil" class="tile__edit" />
				</button>
			</div>
		</template>

		<!-- СТАТУСЫ -->
		<template v-else-if="tab === 'statuses'">
			<p class="lead">
				Статус — это цвет ленты брони в календаре. Привязанный к состоянию ставится сам: оформили бронь —
				«Ожидается заезд», нажали «Заселить» — лента перекрасилась. Без привязки — особые метки, их выбирают в брони вручную.
			</p>
			<h4 class="grp">Статусы брони</h4>
			<div class="tiles">
				<button v-for="(s, i) in bookingStatuses" :key="s.id" type="button" class="tile k-rise k-lift" :style="{ '--i': i }" :disabled="!canEdit" @click="openForm('status', s)">
					<span class="swatch" :style="{ background: s.color }" />
					<span class="tile__body">
						<span class="tile__name">{{ s.name }}</span>
						<span class="tile__sub" :class="{ auto: s.stage }">{{ s.stage ? "ставится сам: " + STAGE_NAME[s.stage] : "особая метка" }}</span>
						<span class="tile__sub">{{ s.used_count }} броней</span>
					</span>
					<Icon v-if="canEdit" name="pencil" class="tile__edit" />
				</button>
			</div>

			<h4 class="grp">Производные состояния <span class="muted">— только цвет, человеку не назначаются</span></h4>
			<div class="tiles">
				<button v-for="s in systemStatuses" :key="s.id" type="button" class="tile sys" :disabled="!canEdit" @click="openForm('status', s)">
					<span class="swatch" :style="{ background: s.color }" />
					<span class="tile__body">
						<span class="tile__name">{{ s.name }}</span>
						<span class="tile__sub">{{ SYSTEM_WHY[s.code] }}</span>
					</span>
					<Icon v-if="canEdit" name="pencil" class="tile__edit" />
				</button>
			</div>
		</template>

		<!-- УДОБСТВА -->
		<template v-else>
			<p class="lead">Удобства отмечаются в номере и в доме. Вахтовик видит их у себя и нажимает на сломанное, чтобы подать заявку.</p>
			<div class="tiles">
				<button v-for="(a, i) in amenities" :key="a.id" type="button" class="tile k-rise k-lift" :style="{ '--i': i }" :disabled="!canEdit" @click="openForm('amenity', a)">
					<span class="tile__ico"><Icon :name="amenityIcon(a.icon)" /></span>
					<span class="tile__body">
						<span class="tile__name">{{ a.name }}</span>
						<span class="tile__sub">{{ SCOPE[a.scope] || a.scope }} · отмечено {{ a.used_count }}</span>
					</span>
					<Icon v-if="canEdit" name="pencil" class="tile__edit" />
				</button>
			</div>
		</template>

		<!-- Окно добавления / правки -->
		<Modal v-if="form" :title="formTitle" @close="form = null">
			<form class="fm" @submit.prevent="saveForm">
				<Field
					label="Название"
					:error="formError === 'Введите название' ? formError : ''"
					:hint="{ class: 'Например: «Двухместный», «Люкс»', status: 'Так статус будет подписан в легенде календаря', amenity: 'Например: «Микроволновка», «Утюг»' }[form.kind]"
				>
					<Input ref="nameEl" v-model="form.name" :invalid="formError === 'Введите название'" @input="formError = ''" />
				</Field>

				<template v-if="form.kind === 'status'">
					<Field label="Цвет ленты">
						<ColorPicker v-model="form.color" :presets="PRESET_COLORS" />
					</Field>
					<div class="preview">
						<span class="muted">Так будет в календаре:</span>
						<span class="preview__ribbon" :style="{ '--rc': form.color }">{{ form.name || "Иванов Иван" }}</span>
					</div>

					<Field v-if="!form.system" label="Когда ставится">
						<div class="choices">
							<label v-for="o in STAGE_OPTIONS" :key="String(o.value)" class="choice" :class="{ on: form.stage === o.value }">
								<input v-model="form.stage" type="radio" :value="o.value" />
								<span>
									<b>{{ o.title }}</b>
									<span class="muted">{{ o.text }}<template v-if="o.value && stageOwner(o.value)"> · сейчас у «{{ stageOwner(o.value).name }}», привязка переедет</template></span>
								</span>
							</label>
						</div>
					</Field>
					<p v-else class="muted note">{{ SYSTEM_WHY[form.code] }}. Можно изменить название и цвет.</p>
				</template>

				<template v-if="form.kind === 'amenity'">
					<Field label="Значок">
						<div class="icons">
							<button
								v-for="i in ICON_OPTIONS"
								:key="i.value"
								type="button"
								class="icon-opt"
								:class="{ on: form.icon === i.value }"
								:title="i.label"
								@click="form.icon = i.value"
							>
								<Icon :name="amenityIcon(i.value)" size="1.3rem" />
								<span>{{ i.label }}</span>
							</button>
						</div>
					</Field>
					<Field label="Где бывает">
						<SegmentedControl v-model="form.scope" :options="SCOPE_OPTIONS" />
					</Field>
				</template>

				<p v-if="formError && formError !== 'Введите название'" class="err"><Icon name="alert-triangle" /> {{ formError }}</p>
				<button type="submit" hidden />
			</form>
			<template #foot>
				<Button
					v-if="form.id && canAdmin && !form.system"
					variant="danger"
					icon="trash"
					@click="remove(
						{ class: classes, status: statuses, amenity: amenities }[form.kind].find((x) => x.id === form.id),
						{ class: '/classes/', status: '/statuses/', amenity: '/amenities/' }[form.kind],
						{ class: 'Тип', status: 'Статус', amenity: 'Удобство' }[form.kind],
					)"
				>
					Удалить
				</Button>
				<span class="grow" />
				<Button variant="ghost" @click="form = null">Отмена</Button>
				<Button variant="primary" icon="check" :loading="saving" @click="saveForm">{{ form.id ? "Сохранить" : "Добавить" }}</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.lead {
	margin: 0;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
	max-width: 80ch;
}
.grp {
	margin: var(--gap-sm) 0 0;
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
}
.grp .muted {
	font-weight: 400;
}
/* Плитки на всю ширину; текст переносится внутри, а не вылезает за край */
.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: var(--gap-sm);
}
.tile {
	display: flex;
	align-items: flex-start;
	gap: var(--gap-md);
	min-width: 0;
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	color: var(--color-base);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: border-color var(--speed-fast);
}
.tile:hover:not(:disabled) {
	border-color: var(--color-brand);
}
.tile:disabled {
	cursor: default;
}
.tile.sys {
	border-style: dashed;
}
.tile__ico {
	display: grid;
	place-items: center;
	width: 2.2rem;
	height: 2.2rem;
	flex-shrink: 0;
	border-radius: var(--radius-md);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.swatch {
	width: 2.2rem;
	height: 1.1rem;
	margin-top: 3px;
	flex-shrink: 0;
	border-radius: 999px;
}
.tile__body {
	flex: 1;
	min-width: 0;
	display: grid;
	gap: 2px;
}
.tile__name {
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
	overflow-wrap: anywhere;
}
.tile__sub {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.tile__sub.auto {
	color: var(--color-green);
}
.tile__edit {
	color: var(--color-secondary);
	opacity: 0;
	transition: opacity var(--speed-fast);
	margin-top: 3px;
}
.tile:hover .tile__edit,
.tile:focus-visible .tile__edit {
	opacity: 1;
}

/* Окно */
.fm {
	display: grid;
	gap: var(--gap-md);
}
.preview {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-xs);
}
.preview__ribbon {
	padding: 4px 12px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--rc) 26%, var(--color-raised-bg));
	border: 1px solid color-mix(in srgb, var(--rc) 70%, transparent);
	box-shadow: inset 3px 0 0 var(--rc);
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
}
.choices {
	display: grid;
	gap: 6px;
}
.choice {
	display: flex;
	gap: var(--gap-sm);
	align-items: flex-start;
	padding: var(--gap-sm) var(--gap-md);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	cursor: pointer;
	font-size: var(--font-size-sm);
}
.choice.on {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.choice input {
	margin-top: 4px;
	accent-color: var(--color-brand);
}
.choice span {
	display: grid;
}
.choice b {
	color: var(--color-contrast);
}
.choice .muted {
	font-size: var(--font-size-xs);
}
.icons {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
	gap: 6px;
}
.icon-opt {
	display: grid;
	justify-items: center;
	gap: 4px;
	padding: var(--gap-sm) 4px;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	color: var(--color-base);
	font: inherit;
	font-size: 0.68rem;
	cursor: pointer;
}
.icon-opt :deep(svg) {
	color: var(--color-brand);
}
.icon-opt.on {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
	color: var(--color-contrast);
}
.note {
	margin: 0;
	font-size: var(--font-size-sm);
}
.err {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	margin: 0;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-red-bg);
	color: var(--color-red);
	font-size: var(--font-size-sm);
}
.grow {
	flex: 1;
}
</style>
