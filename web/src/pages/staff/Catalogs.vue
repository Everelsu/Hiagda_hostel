<script setup>
/**
 * Справочники — три словаря, на которых держится вся система:
 * типы номеров, цветовые статусы брони и каталог удобств.
 * Всё редактируется на месте, у каждой записи видно, где она используется.
 */
import { ref, onMounted, computed } from "vue"
import { api, post, put, del } from "@/api/client"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Input, Select, Button, IconButton, Tabs, EmptyState, confirm } from "@/ui"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const canAdmin = auth.can("admin")

const tab = ref("classes")
const classes = ref([])
const statuses = ref([])
const amenities = ref([])
const loading = ref(true)

const newClass = ref("")
const newStatus = ref({ name: "", color: "#5fc8ff" })
const newAmenity = ref({ name: "", icon: "dot", scope: "both" })
const editing = ref(null) // { kind, id, ...поля }

const ICON_OPTIONS = [
	{ value: "dot", label: "Точка" },
	{ value: "wifi", label: "Wi-Fi" },
	{ value: "tv", label: "Телевизор" },
	{ value: "shower", label: "Душ" },
	{ value: "fridge", label: "Холодильник" },
	{ value: "snow", label: "Кондиционер" },
	{ value: "utensils", label: "Питание" },
	{ value: "washer", label: "Стирка" },
	{ value: "wind", label: "Сушилка" },
	{ value: "dumbbell", label: "Спортзал" },
	{ value: "sofa", label: "Мебель" },
]
const SCOPE = { both: "везде", room: "в номере", hotel: "в доме" }
const PRESET_COLORS = ["#3a3f47", "#5fc8ff", "#1bd96a", "#ff8a5c", "#ff496e", "#c78aff", "#ffd166"]

const bookingStatuses = computed(() => statuses.value.filter((s) => s.kind !== "system"))
const systemStatuses = computed(() => statuses.value.filter((s) => s.kind === "system"))
const SYSTEM_WHY = {
	free: "место свободно — когда на нём нет брони",
	repair: "номер на ремонте — ставится в календаре броней или в плане этажа, на весь номер",
}

const tabs = computed(() => [
	{ value: "classes", label: "Типы номеров", icon: "bed", count: classes.value.length },
	{ value: "statuses", label: "Статусы брони", icon: "tag", count: bookingStatuses.value.length },
	{ value: "amenities", label: "Удобства", icon: "armchair", count: amenities.value.length },
])

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

/* ---------- общие помощники ---------- */
function startEdit(kind, item) {
	if (!canEdit) return
	editing.value = { kind, ...item }
}
async function saveEdit() {
	const e = editing.value
	try {
		if (e.kind === "class") await put("/classes/" + e.id, { name: e.name })
		if (e.kind === "status") await put("/statuses/" + e.id, { name: e.name, color: e.color, sort: e.sort })
		if (e.kind === "amenity") await put("/amenities/" + e.id, { name: e.name, icon: e.icon, scope: e.scope })
		editing.value = null
		await reload()
		toast.success("Сохранено")
	} catch (err) {
		toast.error(err.message)
	}
}
async function remove(kind, item, path, what) {
	const used = item.used_count || 0
	const message = used
		? `Запись используется ${used} раз. Удаление может нарушить связанные данные.`
		: "Запись нигде не используется — удалить безопасно."
	if (!(await confirm({ title: `Удалить «${item.name}»?`, message, danger: true, confirmLabel: "Удалить" }))) return
	try {
		await del(path + item.id)
		await reload()
		toast.success(what + " удалён")
	} catch (e) {
		toast.error(e.message)
	}
}

/* ---------- добавление ---------- */
async function addClass() {
	const name = newClass.value.trim()
	if (!name) return
	try {
		await post("/classes", { name })
		newClass.value = ""
		await reload()
	} catch (e) {
		toast.error(e.message)
	}
}
async function addStatus() {
	if (!newStatus.value.name.trim()) return
	try {
		await post("/statuses", { ...newStatus.value, sort: statuses.value.length })
		newStatus.value = { name: "", color: "#5fc8ff" }
		await reload()
	} catch (e) {
		toast.error(e.message)
	}
}
async function addAmenity() {
	if (!newAmenity.value.name.trim()) return
	try {
		await post("/amenities", { ...newAmenity.value })
		newAmenity.value = { name: "", icon: "dot", scope: "both" }
		await reload()
	} catch (e) {
		toast.error(e.message)
	}
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Справочники" subtitle="Словари, на которые опираются номера и брони" icon="tag" />

		<Tabs v-model="tab" :options="tabs" />

		<!-- ТИПЫ НОМЕРОВ -->
		<template v-if="tab === 'classes'">
			<p class="lead">Тип номера — категория вроде «Одноместный» или «Двухместный». По нему фильтруются календарь броней и поиск свободных мест.</p>

			<Card v-if="canEdit" pad="md" class="addbar">
				<Input v-model="newClass" placeholder="Например: Двухместный" @keyup.enter="addClass" />
				<Button variant="primary" icon="plus" @click="addClass">Добавить тип</Button>
			</Card>

			<Card v-if="!loading && !classes.length"><EmptyState icon="bed" title="Типов нет" text="Добавьте первый тип номера." /></Card>
			<div v-else class="list">
				<div v-for="c in classes" :key="c.id" class="item">
					<template v-if="editing?.kind === 'class' && editing.id === c.id">
						<Input v-model="editing.name" style="flex: 1" @keyup.enter="saveEdit" />
						<Button size="sm" variant="primary" icon="check" @click="saveEdit" />
						<Button size="sm" variant="ghost" icon="x" @click="editing = null" />
					</template>
					<template v-else>
						<Icon name="bed" class="item-ico" />
						<span class="item-name">{{ c.name }}</span>
						<span class="usage" :class="{ zero: !c.used_count }">{{ c.used_count }} ном.</span>
						<IconButton v-if="canEdit" icon="pencil" label="Переименовать" size="sm" @click="startEdit('class', c)" />
						<IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click="remove('class', c, '/classes/', 'Тип')" />
					</template>
				</div>
			</div>
		</template>

		<!-- СТАТУСЫ -->
		<template v-else-if="tab === 'statuses'">
			<p class="lead">
				Цвет статуса — это цвет ленты брони в календаре броней. Статус брони назначают человеку при заселении.
				Свободно и Ремонт — производные состояния: их никому не назначают, они только задают цвет.
			</p>

			<Card v-if="canEdit" pad="md" class="addbar">
				<Input v-model="newStatus.name" placeholder="Название статуса" style="flex: 1" @keyup.enter="addStatus" />
				<div class="swatches">
					<button
						v-for="c in PRESET_COLORS"
						:key="c"
						type="button"
						class="sw"
						:class="{ on: newStatus.color === c }"
						:style="{ background: c }"
						@click="newStatus.color = c"
					/>
					<input v-model="newStatus.color" type="color" class="colorpick" title="Свой цвет" />
				</div>
				<Button variant="primary" icon="plus" @click="addStatus">Добавить</Button>
			</Card>

			<h4 class="grp">Статусы брони <span class="muted">— назначаются человеку</span></h4>
			<div class="list">
				<div v-for="s in bookingStatuses" :key="s.id" class="item">
					<template v-if="editing?.kind === 'status' && editing.id === s.id">
						<input v-model="editing.color" type="color" class="colorpick" />
						<Input v-model="editing.name" style="flex: 1" @keyup.enter="saveEdit" />
						<Button size="sm" variant="primary" icon="check" @click="saveEdit" />
						<Button size="sm" variant="ghost" icon="x" @click="editing = null" />
					</template>
					<template v-else>
						<span class="ribbon-demo" :style="{ background: s.color }" />
						<span class="item-name">{{ s.name }}</span>
						<span class="usage" :class="{ zero: !s.used_count }">{{ s.used_count }} брон.</span>
						<IconButton v-if="canEdit" icon="pencil" label="Изменить" size="sm" @click="startEdit('status', s)" />
						<IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click="remove('status', s, '/statuses/', 'Статус')" />
					</template>
				</div>
			</div>

			<h4 class="grp">Производные состояния <span class="muted">— только цвет, назначить нельзя</span></h4>
			<div class="list">
				<div v-for="s in systemStatuses" :key="s.id" class="item sys">
					<template v-if="editing?.kind === 'status' && editing.id === s.id">
						<input v-model="editing.color" type="color" class="colorpick" />
						<Input v-model="editing.name" style="flex: 1" @keyup.enter="saveEdit" />
						<Button size="sm" variant="primary" icon="check" @click="saveEdit" />
						<Button size="sm" variant="ghost" icon="x" @click="editing = null" />
					</template>
					<template v-else>
						<span class="ribbon-demo" :style="{ background: s.color }" />
						<span class="grow">
							<span class="item-name">{{ s.name }}</span>
							<span class="muted sys-why">{{ SYSTEM_WHY[s.code] }}</span>
						</span>
						<IconButton v-if="canEdit" icon="pencil" label="Изменить цвет и подпись" size="sm" @click="startEdit('status', s)" />
					</template>
				</div>
			</div>
		</template>

		<!-- УДОБСТВА -->
		<template v-else>
			<p class="lead">Удобства отмечаются в номере и в доме. Вахтовик видит их у себя и жмёт по сломанному, чтобы подать заявку.</p>

			<Card v-if="canEdit" pad="md" class="addbar wrap">
				<Input v-model="newAmenity.name" placeholder="Название удобства" style="flex: 1; min-width: 160px" @keyup.enter="addAmenity" />
				<Select v-model="newAmenity.icon" style="width: auto">
					<option v-for="i in ICON_OPTIONS" :key="i.value" :value="i.value">{{ i.label }}</option>
				</Select>
				<Select v-model="newAmenity.scope" style="width: auto">
					<option value="both">везде</option>
					<option value="room">в номере</option>
					<option value="hotel">в доме</option>
				</Select>
				<Button variant="primary" icon="plus" @click="addAmenity">Добавить</Button>
			</Card>

			<div class="grid-amen">
				<div v-for="a in amenities" :key="a.id" class="item">
					<template v-if="editing?.kind === 'amenity' && editing.id === a.id">
						<Input v-model="editing.name" style="flex: 1; min-width: 100px" @keyup.enter="saveEdit" />
						<Select v-model="editing.icon" style="width: auto">
							<option v-for="i in ICON_OPTIONS" :key="i.value" :value="i.value">{{ i.label }}</option>
						</Select>
						<Select v-model="editing.scope" style="width: auto">
							<option value="both">везде</option>
							<option value="room">в номере</option>
							<option value="hotel">в доме</option>
						</Select>
						<Button size="sm" variant="primary" icon="check" @click="saveEdit" />
						<Button size="sm" variant="ghost" icon="x" @click="editing = null" />
					</template>
					<template v-else>
						<span class="amen-ico"><Icon :name="amenityIcon(a.icon)" size="1.15rem" /></span>
						<span class="grow">
							<span class="item-name">{{ a.name }}</span>
							<span class="muted amen-scope">{{ SCOPE[a.scope] || a.scope }} · привязано {{ a.used_count }}</span>
						</span>
						<IconButton v-if="canEdit" icon="pencil" label="Изменить" size="sm" @click="startEdit('amenity', a)" />
						<IconButton v-if="canAdmin" icon="trash" label="Удалить" size="sm" variant="danger" @click="remove('amenity', a, '/amenities/', 'Удобство')" />
					</template>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
.lead {
	margin: 0;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
	max-width: 70ch;
}
.addbar {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.addbar.wrap {
	flex-wrap: wrap;
}
.list {
	display: grid;
	gap: var(--gap-xs);
	max-width: 720px;
}
.grid-amen {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: var(--gap-xs);
}
.item {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	min-height: 48px;
}
.item:hover {
	border-color: color-mix(in srgb, var(--color-brand), transparent 55%);
}
.item-ico {
	color: var(--color-brand);
	flex-shrink: 0;
}
.item-name {
	display: block;
	font-weight: 700;
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.list .item-name {
	flex: 1;
}
.usage {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	padding: 2px 8px;
	background: var(--color-bg);
	border-radius: var(--radius-max);
	white-space: nowrap;
}
.usage.zero {
	opacity: 0.55;
}
.grp {
	margin: var(--gap-md) 0 var(--gap-xs);
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
}
.grp .muted {
	font-weight: 400;
	font-size: var(--font-size-xs);
}
.item.sys {
	background: var(--color-bg);
	border-style: dashed;
}
.sys-why {
	display: block;
	font-size: var(--font-size-xs);
}
.ribbon-demo {
	width: 34px;
	height: 14px;
	border-radius: 999px;
	flex-shrink: 0;
}
.swatches {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.sw {
	width: 22px;
	height: 22px;
	border-radius: var(--radius-max);
	border: 2px solid transparent;
	cursor: pointer;
	padding: 0;
}
.sw.on {
	border-color: var(--color-contrast);
	transform: scale(1.12);
}
.colorpick {
	width: 34px;
	height: 28px;
	padding: 2px;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-sm);
	cursor: pointer;
	flex-shrink: 0;
}
.amen-ico {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border-radius: var(--radius-md);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	flex-shrink: 0;
}
.amen-scope {
	font-size: var(--font-size-xs);
}
</style>
