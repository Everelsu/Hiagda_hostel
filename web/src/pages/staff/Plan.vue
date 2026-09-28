<script setup>
import { ref, onMounted, computed, watch } from "vue"
import { api, post, put, del } from "@/api/client"
import { today, dm, dateTime } from "@/utils/date"
import { toast } from "@/toast"
import { useAuthStore } from "@/stores/auth"
import { useCounters } from "@/stores/counters"
import FloorPlan from "@/components/FloorPlan.vue"
import PlacementModal from "@/components/PlacementModal.vue"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Select, Input, Button, IconButton, Drawer, Chip, StatusDot, EmptyState, Field, confirm, DateInput } from "@/ui"

const auth = useAuthStore()
const counters = useCounters()
const canEdit = auth.can("editor")
const canRepair = auth.canRepair // ремонтник тоже ставит и снимает ремонт

const hotels = ref([])
const hotelId = ref(null)
const date = ref(today())
const rooms = ref([])
const shapes = ref([])
const floor = ref(null)
const editing = ref(false)
const carving = ref(false)
const dirty = ref(false)
const saving = ref(false)
const selectedId = ref(null)

const roomDetail = ref(null)
const placement = ref(null)
const blocks = ref([])
const blockForm = ref({ date_from: "", date_to: "", reason: "" })
const roomIssues = ref([])

const SHAPE_KINDS = [
	{ value: "corridor", label: "Коридор" },
	{ value: "stairs", label: "Лестница" },
	{ value: "exit", label: "Выход" },
	{ value: "wc", label: "Санузел" },
	{ value: "shower", label: "Душевая" },
	{ value: "kitchen", label: "Кухня" },
	{ value: "laundry", label: "Прачечная" },
	{ value: "lounge", label: "Комната отдыха" },
	{ value: "office", label: "Комендант" },
	{ value: "other", label: "Другое" },
]

/* ---------- загрузка ---------- */
onMounted(async () => {
	hotels.value = await api("/hotels")
	hotelId.value = hotels.value[0]?.id
	await load()
})

async function load() {
	if (!hotelId.value) return
	const r = await api(`/plan?hotel_id=${hotelId.value}&date=${date.value}`)
	rooms.value = r.rooms
	shapes.value = r.shapes || []
	const list = floors.value
	if (floor.value == null || !list.includes(floor.value)) floor.value = list[0] ?? 1
	dirty.value = false
	if (roomDetail.value) roomDetail.value = rooms.value.find((x) => x.id === roomDetail.value.id) || null
}

const floors = computed(() => [...new Set(rooms.value.map((r) => r.floor ?? 1))].sort((a, b) => a - b))
const floorRooms = computed(() => rooms.value.filter((r) => (r.floor ?? 1) === floor.value))
const floorShapes = computed(() => shapes.value.filter((s) => s.floor === floor.value))
const placed = computed(() => floorRooms.value.filter((r) => r.plan_x != null))
const unplaced = computed(() => floorRooms.value.filter((r) => r.plan_x == null))

// Цвет номера на плане: ремонт → занятость
function toneOf(r) {
	if (editing.value) return "plain"
	if (r.block) return "repair"
	if (!r.occupied) return "free"
	return r.occupied >= r.capacity ? "full" : "part"
}

const planRooms = computed(() =>
	placed.value.map((r) => ({
		...r,
		tone: toneOf(r),
		label: "№ " + r.number,
		sub: editing.value ? r.class_name || "" : `${r.occupied}/${r.capacity}`,
	})),
)

const stats = computed(() => {
	const beds = floorRooms.value.reduce((s, r) => s + r.capacity, 0)
	const busy = floorRooms.value.reduce((s, r) => s + r.occupied, 0)
	return { rooms: floorRooms.value.length, beds, busy, free: beds - busy, repair: floorRooms.value.filter((r) => r.block).length }
})

/* ---------- редактор ---------- */
watch(editing, (on) => {
	selectedId.value = null
	carving.value = false
	if (!on) load()
})

/* Вырезание клеток: даёт углы, впадины и Г-образные комнаты.
   Маска — строки "111/101" по габариту; нельзя вырезать всё. */
function maskGrid(mask, w, h) {
	const rows = typeof mask === "string" && mask ? mask.split("/") : []
	return Array.from({ length: h }, (_, y) =>
		Array.from({ length: w }, (_, x) => (rows.length ? rows[y]?.[x] !== "0" : true)),
	)
}
function onCarve({ type, id, cx, cy }) {
	const item = (type === "room" ? rooms.value : shapes.value).find((i) => i.id === id)
	if (!item) return
	const w = type === "room" ? item.plan_w : item.w
	const h = type === "room" ? item.plan_h : item.h
	if (cx < 0 || cy < 0 || cx >= w || cy >= h) return
	const grid = maskGrid(type === "room" ? item.plan_cells : item.cells, w, h)
	grid[cy][cx] = !grid[cy][cx]
	if (!grid.flat().some(Boolean)) return toast.error("Нельзя вырезать всё помещение")
	const flat = grid.map((row) => row.map((v) => (v ? "1" : "0")).join("")).join("/")
	const value = flat.includes("0") ? flat : null
	if (type === "room") item.plan_cells = value
	else item.cells = value
	dirty.value = true
}
function resetShape() {
	const id = selectedId.value
	if (typeof id === "number") {
		const r = rooms.value.find((x) => x.id === id)
		if (r) (r.plan_cells = null), (dirty.value = true)
	} else if (selectedShape.value) {
		selectedShape.value.cells = null
		dirty.value = true
	}
}
const selectedRoom = computed(() => (typeof selectedId.value === "number" ? placed.value.find((r) => r.id === selectedId.value) : null))
const carvedSelection = computed(() => !!(selectedRoom.value?.plan_cells || selectedShape.value?.cells))

function onMove({ type, id, x, y, w, h }) {
	const list = type === "room" ? rooms.value : shapes.value
	const item = list.find((i) => i.id === id)
	if (!item) return
	if (type === "room") {
		if (x != null) (item.plan_x = x), (item.plan_y = y)
		if (w != null) (item.plan_w = w), (item.plan_h = h)
	} else {
		if (x != null) (item.x = x), (item.y = y)
		if (w != null) (item.w = w), (item.h = h)
	}
	dirty.value = true
}

// Кладём номер на первое свободное место сетки
function placeRoom(room) {
	const taken = new Set()
	for (const r of placed.value) for (let i = 0; i < r.plan_w; i++) for (let j = 0; j < r.plan_h; j++) taken.add(`${r.plan_x + i},${r.plan_y + j}`)
	for (const s of floorShapes.value) for (let i = 0; i < s.w; i++) for (let j = 0; j < s.h; j++) taken.add(`${s.x + i},${s.y + j}`)
	const w = 3
	const h = 2
	outer: for (let y = 0; y <= 16 - h; y++) {
		for (let x = 0; x <= 24 - w; x++) {
			let ok = true
			for (let i = 0; i < w && ok; i++) for (let j = 0; j < h; j++) if (taken.has(`${x + i},${y + j}`)) { ok = false; break }
			if (ok) {
				Object.assign(room, { plan_x: x, plan_y: y, plan_w: w, plan_h: h })
				dirty.value = true
				selectedId.value = room.id
				break outer
			}
		}
	}
}
// Быстрый старт: пустой этаж раскладываем «коридор посередине, номера по сторонам»,
// иначе просто досаживаем неразмещённые номера на свободные места.
function autoLayout() {
	const list = [...unplaced.value].sort((a, b) => String(a.number).localeCompare(String(b.number), "ru", { numeric: true }))
	const perRow = Math.ceil(list.length / 2)
	if (!placed.value.length && !floorShapes.value.length && perRow <= 8) {
		list.forEach((r, i) => {
			const top = i < perRow
			Object.assign(r, { plan_x: (top ? i : i - perRow) * 3, plan_y: top ? 0 : 4, plan_w: 3, plan_h: 2 })
		})
		shapes.value.push({ id: tmpId--, floor: floor.value, kind: "corridor", label: null, x: 0, y: 2, w: perRow * 3, h: 2, cells: null })
		dirty.value = true
	} else list.forEach(placeRoom)
	selectedId.value = null
	toast.success("Номера расставлены — поправьте мышью и сохраните")
}
function startAutoLayout() {
	editing.value = true
	// watch(editing) сбрасывает выделение асинхронно — раскладываем после него
	setTimeout(autoLayout)
}
function unplaceRoom(room) {
	Object.assign(room, { plan_x: null, plan_y: null, plan_w: null, plan_h: null })
	dirty.value = true
	selectedId.value = null
}
let tmpId = -1
function addShape(kind) {
	shapes.value.push({ id: tmpId--, floor: floor.value, kind, label: null, x: 0, y: 0, w: kind === "corridor" ? 8 : 3, h: 2, cells: null })
	dirty.value = true
}
function removeShape(s) {
	shapes.value = shapes.value.filter((x) => x !== s)
	dirty.value = true
	selectedId.value = null
}
const selectedShape = computed(() => {
	const id = String(selectedId.value || "")
	return id.startsWith("shape-") ? shapes.value.find((s) => "shape-" + s.id === id) || null : null
})

async function saveLayout() {
	saving.value = true
	try {
		await put("/plan/layout", {
			hotel_id: hotelId.value,
			floor: floor.value,
			rooms: floorRooms.value.map((r) => ({
				id: r.id,
				plan_x: r.plan_x,
				plan_y: r.plan_y,
				plan_w: r.plan_w,
				plan_h: r.plan_h,
				plan_cells: r.plan_cells || null,
			})),
			shapes: floorShapes.value.map((s) => ({ kind: s.kind, label: s.label, x: s.x, y: s.y, w: s.w, h: s.h, cells: s.cells || null })),
		})
		toast.success("План этажа сохранён")
		editing.value = false
	} catch (e) {
		toast.error(e.message)
	} finally {
		saving.value = false
	}
}

/* ---------- карточка номера ---------- */
async function openRoom(r) {
	if (editing.value) return
	roomDetail.value = r
	blockForm.value = { date_from: date.value, date_to: date.value, reason: "" }
	blocks.value = canRepair ? await api(`/rooms/${r.id}/blocks`) : []
	try {
		roomIssues.value = await api(`/rooms/${r.id}/issues`)
	} catch {
		roomIssues.value = []
	}
}
const activeIssues = computed(() => roomIssues.value.filter((x) => x.status !== "Починено"))

async function updateIssueStatus(issue, status) {
	try {
		await put(`/issues/${issue.id}/status`, { status })
		roomIssues.value = await api(`/rooms/${roomDetail.value.id}/issues`)
		await load()
		counters.refresh()
		toast.success(`Статус: «${status}»`)
	} catch (e) {
		toast.error(e.message)
	}
}
async function addBlock() {
	try {
		await post(`/rooms/${roomDetail.value.id}/blocks`, blockForm.value)
		blocks.value = await api(`/rooms/${roomDetail.value.id}/blocks`)
		blockForm.value = { date_from: date.value, date_to: date.value, reason: "" }
		await load()
		toast.success("Номер поставлен на ремонт")
	} catch (e) {
		toast.error(e.message)
	}
}
async function removeBlock(b) {
	if (!(await confirm({ title: "Снять ремонт?", danger: true, confirmLabel: "Снять" }))) return
	await del("/blocks/" + b.id)
	blocks.value = await api(`/rooms/${roomDetail.value.id}/blocks`)
	await load()
}
function openBed(bed) {
	if (!canEdit) return
	placement.value = { bed, existing: bed.placement }
}
</script>

<template>
	<div class="grid">
		<PageHeader title="План этажа" subtitle="Схема здания: где какой номер и что занято на выбранную дату" icon="layout">
			<template #actions>
				<Select v-model="hotelId" style="width: auto" title="Гостиница" @change="load">
					<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
				</Select>
				<DateInput v-if="!editing" v-model="date" style="width: auto" title="На какую дату показывать занятость" @change="load" />
				<Button v-if="canEdit && !editing" icon="pencil" @click="editing = true">Редактировать план</Button>
				<template v-else-if="canEdit">
					<Button variant="ghost" @click="editing = false">Отмена</Button>
					<Button variant="primary" icon="check" :loading="saving" :disabled="!dirty" @click="saveLayout">Сохранить</Button>
				</template>
			</template>
		</PageHeader>

		<Card v-if="!floors.length"><EmptyState icon="layout" title="Номеров нет" text="Добавьте номера в разделе «Гостиницы и номера»." /></Card>

		<Card v-else-if="!editing && !placed.length && !floorShapes.length">
			<EmptyState icon="layout" title="План этого этажа ещё не начерчен" text="Расставьте номера на схеме — вахтовики увидят, где их комната, душевая и выход, а вы — занятость этажа одним взглядом.">
				<div v-if="canEdit" class="row wrap" style="justify-content: center; gap: var(--gap-sm)">
					<Button variant="primary" icon="layout" @click="startAutoLayout">Расставить автоматически</Button>
					<Button icon="pencil" @click="editing = true">Начертить вручную</Button>
				</div>
			</EmptyState>
			<div v-if="floors.length > 1" class="floors" style="justify-content: center; margin-top: var(--gap-md)">
				<button v-for="f in floors" :key="f" type="button" class="fbtn" :class="{ on: f === floor }" @click="floor = f">{{ f }} этаж</button>
			</div>
		</Card>

		<template v-else>
			<div class="bar">
				<div class="floors">
					<button v-for="f in floors" :key="f" type="button" class="fbtn" :class="{ on: f === floor }" @click="floor = f">
						{{ f }} этаж
					</button>
				</div>
				<div v-if="!editing" class="legend">
					<span class="leg"><StatusDot color="var(--color-gray)" /> свободен</span>
					<span class="leg"><StatusDot color="var(--color-green)" /> частично</span>
					<span class="leg"><StatusDot color="var(--color-red)" /> занят</span>
					<span class="leg"><StatusDot color="var(--color-orange)" /> ремонт</span>
				</div>
			</div>

			<div v-if="!editing" class="stats">
				<div><b>{{ stats.rooms }}</b><span>номеров</span></div>
				<div><b>{{ stats.free }}</b><span>свободных мест</span></div>
				<div><b>{{ stats.busy }}</b><span>занято мест</span></div>
				<div :class="{ warn: stats.repair }"><b>{{ stats.repair }}</b><span>на ремонте</span></div>
			</div>

			<!-- Панель редактора -->
			<Card v-if="editing" pad="md" class="editor-bar">
				<div class="ed-row">
					<span class="ed-title"><Icon name="layout" /> Конструктор плана</span>
					<span class="muted ed-hint">
						{{ carving
							? "Кликайте по клеткам помещения: клик убирает клетку, повторный — возвращает. Так делаются углы и впадины."
							: "Тяните блоки мышью, угол — размер. Номера без места — в списке справа." }}
					</span>
				</div>
				<div class="ed-row">
					<Button :variant="carving ? 'primary' : undefined" icon="layout" @click="carving = !carving">
						{{ carving ? "Готово с формой" : "Форма: вырезать клетки" }}
					</Button>
					<Button v-if="carvedSelection" variant="ghost" icon="rotate-cw" @click="resetShape">Снова прямоугольник</Button>
					<Button v-if="!carving && unplaced.length" icon="plus" @click="autoLayout">Расставить неразмещённые ({{ unplaced.length }})</Button>
					<span v-if="carving && !selectedId" class="muted ed-hint">Выберите номер или помещение и кликайте по его клеткам.</span>
				</div>
				<div v-if="!carving" class="ed-row">
					<span class="muted ed-label">Добавить помещение:</span>
					<button v-for="k in SHAPE_KINDS" :key="k.value" type="button" class="addchip" @click="addShape(k.value)">
						<Icon name="plus" size="0.8rem" /> {{ k.label }}
					</button>
				</div>
				<div v-if="selectedShape" class="ed-row sel">
					<Field label="Подпись выбранного помещения" style="flex: 1; min-width: 180px">
						<Input v-model="selectedShape.label" placeholder="например: Душевая (муж.)" @input="dirty = true" />
					</Field>
					<Button variant="danger" icon="trash" @click="removeShape(selectedShape)">Удалить</Button>
				</div>
			</Card>

			<div class="plan-grid" :class="{ editing }">
				<FloorPlan
					:rooms="planRooms"
					:shapes="floorShapes"
					:editable="editing"
					:carving="carving"
					:selected-id="selectedId"
					@select="selectedId = $event"
					@move="onMove"
					@carve="onCarve"
					@open="openRoom"
				/>

				<Card v-if="editing" pad="md" class="tray">
					<div class="tray-title">Не размещены <span class="muted">({{ unplaced.length }})</span></div>
					<p v-if="!unplaced.length" class="muted tray-empty">Все номера этажа на плане.</p>
					<button v-for="r in unplaced" :key="r.id" type="button" class="tray-item" @click="placeRoom(r)">
						<span><b>№ {{ r.number }}</b><span class="muted"> · {{ r.class_name || "—" }}</span></span>
						<Icon name="plus" size="0.9rem" />
					</button>

					<template v-if="placed.length">
						<div class="tray-title" style="margin-top: var(--gap-md)">На плане</div>
						<button v-for="r in placed" :key="r.id" type="button" class="tray-item" :class="{ on: selectedId === r.id }" @click="selectedId = r.id">
							<span><b>№ {{ r.number }}</b></span>
							<IconButton icon="x" label="Убрать с плана" size="sm" @click.stop="unplaceRoom(r)" />
						</button>
					</template>
				</Card>
			</div>

			<Card v-if="!editing && unplaced.length" pad="md">
				<div class="row" style="gap: var(--gap-sm)">
					<Icon name="info" style="color: var(--color-orange)" />
					<span class="muted">
						Не на плане: <b class="contrast">{{ unplaced.map((r) => "№ " + r.number).join(", ") }}</b>.
						<template v-if="canEdit"> Нажмите «Редактировать план», чтобы разместить.</template>
					</span>
				</div>
			</Card>
		</template>

		<!-- Карточка номера -->
		<Drawer v-if="roomDetail" :title="'Номер № ' + roomDetail.number" width="520px" @close="roomDetail = null">
			<div class="row wrap" style="gap: var(--gap-sm)">
				<Chip dot :color="roomDetail.occupied >= roomDetail.capacity ? 'var(--color-red)' : 'var(--color-green)'">
					занято {{ roomDetail.occupied }} из {{ roomDetail.capacity }}
				</Chip>
				<Chip v-if="roomDetail.class_name">{{ roomDetail.class_name }}</Chip>
				<Chip v-if="roomDetail.block" color="var(--color-orange)" dot>на ремонте</Chip>
			</div>

			<div class="section-title" style="margin-top: var(--gap-md)">Места</div>
			<button v-for="b in roomDetail.beds" :key="b.id" class="bedrow" @click="openBed(b)">
				<StatusDot :color="b.placement ? b.placement.status_color : 'var(--color-gray)'" size="12px" />
				<span class="grow">
					<b class="contrast">{{ b.label }}</b> —
					<template v-if="b.placement">
						{{ b.placement.resident_name || b.placement.status_name }}
						<span class="muted">({{ dm(b.placement.date_from) }} – {{ dm(b.placement.date_to) }})</span>
					</template>
					<span v-else class="muted">свободно</span>
				</span>
				<Icon v-if="canEdit" name="pencil" class="muted" />
			</button>

			<div class="section-title" style="margin-top: var(--gap-md)">Заявки жильцов ({{ activeIssues.length }})</div>
			<p v-if="!activeIssues.length" class="muted" style="font-size: var(--font-size-sm)">Активных заявок нет.</p>
			<div v-for="issue in activeIssues" :key="issue.id" class="issue" :class="issue.status === 'Новая' ? 'new' : 'work'">
				<div class="grow">
					<div class="issue-head"><b class="contrast">{{ issue.amenity_name || "Заявка" }}</b> <Chip>{{ issue.status }}</Chip></div>
					<div class="issue-text">{{ issue.comment }}</div>
					<div class="muted issue-meta">{{ issue.user_name || "Вахтовик" }} · {{ dateTime(issue.created_at) }}</div>
				</div>
				<div class="row" style="gap: 4px">
					<Button v-if="issue.status === 'Новая'" size="sm" @click="updateIssueStatus(issue, 'В работе')">В работу</Button>
					<Button size="sm" variant="primary" @click="updateIssueStatus(issue, 'Починено')">Готово</Button>
				</div>
			</div>

			<template v-if="canRepair">
				<div class="section-title" style="margin-top: var(--gap-md)">Ремонт</div>
				<div v-for="b in blocks" :key="b.id" class="bedrow">
					<Icon name="wrench" style="color: var(--color-orange)" />
					<span class="grow">{{ dm(b.date_from) }} – {{ dm(b.date_to) }}<template v-if="b.reason"> · {{ b.reason }}</template></span>
					<IconButton icon="trash" label="Снять" size="sm" variant="danger" @click="removeBlock(b)" />
				</div>
				<div class="row wrap" style="margin-top: var(--gap-sm); gap: var(--gap-sm)">
					<DateInput v-model="blockForm.date_from" style="width: auto" />
					<DateInput v-model="blockForm.date_to" :min="blockForm.date_from" style="width: auto" />
					<Input v-model="blockForm.reason" placeholder="Причина" style="min-width: 120px; flex: 1" />
					<Button icon="wrench" @click="addBlock">На ремонт</Button>
				</div>
			</template>
		</Drawer>

		<PlacementModal v-if="placement" v-bind="placement" :date="date" @close="placement = null" @saved="placement = null; load()" />
	</div>
</template>

<style scoped>
.bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.floors {
	display: inline-flex;
	gap: 2px;
	padding: 3px;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.fbtn {
	padding: var(--gap-xs) var(--gap-md);
	font: inherit;
	font-size: var(--font-size-sm);
	font-weight: 700;
	cursor: pointer;
	color: var(--color-secondary);
	background: transparent;
	border: none;
	border-radius: var(--radius-sm);
}
.fbtn.on {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.legend {
	display: flex;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.leg {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
	gap: var(--gap-sm);
}
.stats div {
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.stats b {
	display: block;
	font-size: var(--font-size-xl);
	font-weight: 800;
	color: var(--color-contrast);
	line-height: 1.1;
}
.stats span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.stats .warn b {
	color: var(--color-orange);
}
.editor-bar {
	background: var(--brand-gradient-bg), var(--color-raised-bg);
	display: grid;
	gap: var(--gap-sm);
}
.ed-row {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.ed-row.sel {
	align-items: flex-end;
	padding-top: var(--gap-sm);
	border-top: 1px solid var(--color-divider);
}
.ed-title {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-weight: 800;
	color: var(--color-contrast);
}
.ed-hint,
.ed-label {
	font-size: var(--font-size-xs);
}
.addchip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px var(--gap-sm);
	font: inherit;
	font-size: var(--font-size-xs);
	font-weight: 600;
	cursor: pointer;
	color: var(--color-base);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-max);
}
.addchip:hover {
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.plan-grid {
	display: grid;
	gap: var(--gap-lg);
}
.plan-grid.editing {
	grid-template-columns: minmax(0, 1fr) 240px;
	align-items: start;
}
.tray {
	display: grid;
	gap: var(--gap-xs);
	align-content: start;
	max-height: 560px;
	overflow: auto;
}
.tray-title {
	font-weight: 800;
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.tray-empty {
	font-size: var(--font-size-xs);
	margin: 0;
}
.tray-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-sm);
	width: 100%;
	padding: var(--gap-xs) var(--gap-sm);
	font: inherit;
	font-size: var(--font-size-sm);
	cursor: pointer;
	text-align: left;
	color: var(--color-base);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.tray-item:hover,
.tray-item.on {
	border-color: var(--color-brand);
}
.bedrow {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	width: 100%;
	padding: var(--gap-sm) var(--gap-md);
	margin-bottom: var(--gap-xs);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	cursor: pointer;
	font: inherit;
	color: var(--color-base);
	text-align: left;
}
.bedrow:hover {
	border-color: var(--color-brand);
}
.issue {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	margin-bottom: var(--gap-xs);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-left: 3px solid var(--color-gray);
	border-radius: var(--radius-md);
}
.issue.new {
	border-left-color: var(--color-red);
}
.issue.work {
	border-left-color: var(--color-orange);
}
.issue-head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.issue-text {
	font-size: var(--font-size-sm);
	margin-top: 2px;
}
.issue-meta {
	font-size: var(--font-size-xs);
	margin-top: 2px;
}
@media (max-width: 900px) {
	.plan-grid.editing {
		grid-template-columns: 1fr;
	}
}
</style>
