<script setup>
import { ref, onMounted, computed } from "vue"
import { useRouter } from "vue-router"
import { api } from "@/api/client"
import MapView from "@/components/MapView.vue"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Chip, StatusDot, Skeleton, EmptyState, Button, Input, Select, SegmentedControl } from "@/ui"

const router = useRouter()
const rows = ref([])
const loading = ref(true)
const selectedId = ref(null)
const q = ref("")
const filter = ref("all")
const sort = ref("free")

async function load() {
	loading.value = true
	try {
		rows.value = await api("/map")
		if (!visible.value.some((r) => String(r.id) === String(selectedId.value))) {
			selectedId.value = visible.value.find((r) => r.latitude != null)?.id || visible.value[0]?.id || null
		}
	} finally {
		loading.value = false
	}
}
onMounted(load)

// Порог «плотно» — когда свободных мест почти не осталось
function tone(row) {
	if (!row.beds) return "empty"
	if (row.free === 0) return "full"
	return row.occupancy >= 85 ? "tight" : "free"
}
const TONE = {
	free: { color: "#1bd96a", label: "есть места" },
	tight: { color: "#ffa347", label: "мало мест" },
	full: { color: "#ff496e", label: "мест нет" },
	empty: { color: "#7a828e", label: "нет мест в фонде" },
}
const colorOf = (row) => TONE[tone(row)].color
const labelOf = (row) => TONE[tone(row)].label

const filterOptions = computed(() => [
	{ value: "all", label: "Все", count: rows.value.length },
	{ value: "free", label: "Есть места", count: rows.value.filter((r) => r.free > 0).length },
	{ value: "full", label: "Заняты", count: rows.value.filter((r) => r.beds && r.free === 0).length },
])

const SORTS = {
	free: (a, b) => b.free - a.free,
	load: (a, b) => b.occupancy - a.occupancy,
	name: (a, b) => a.name.localeCompare(b.name, "ru"),
}
const visible = computed(() => {
	const term = q.value.trim().toLowerCase()
	return rows.value
		.filter((r) => {
			if (filter.value === "free" && !(r.free > 0)) return false
			if (filter.value === "full" && !(r.beds && r.free === 0)) return false
			if (!term) return true
			return [r.name, r.settlement, r.address].filter(Boolean).some((v) => v.toLowerCase().includes(term))
		})
		.sort(SORTS[sort.value])
})
// Короткая подпись на карте: «Вахтовый посёлок «Хиагда», корпус 1» → «корпус 1»
const shortName = (n) => {
	const tail = n.split(",").pop().trim()
	return (tail.length >= 4 ? tail : n).slice(0, 26)
}

const withCoords = computed(() => visible.value.filter((r) => r.latitude != null && r.longitude != null))
const missing = computed(() => rows.value.filter((r) => r.latitude == null || r.longitude == null))
const selected = computed(() => rows.value.find((r) => String(r.id) === String(selectedId.value)))

const totals = computed(() => ({
	free: rows.value.reduce((s, r) => s + r.free, 0),
	beds: rows.value.reduce((s, r) => s + r.beds, 0),
	arrivals: rows.value.reduce((s, r) => s + r.arrivals, 0),
	issues: rows.value.reduce((s, r) => s + (r.issues || 0), 0),
}))

const markers = computed(() =>
	withCoords.value.map((r) => ({
		id: r.id,
		lat: r.latitude,
		lng: r.longitude,
		color: colorOf(r),
		badge: r.free,
		label: shortName(r.name),
		// Подробности — в карточке справа, попап их только дублировал и закрывал соседей
		title: `${r.name} — свободно ${r.free} из ${r.beds}`,
	})),
)

function openRack(row) {
	router.push({ name: "rack", query: { hotel_id: row.id } })
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Карта размещения" subtitle="Число на метке — сколько мест свободно сегодня" icon="map">
			<template #actions>
				<Button icon="rotate-cw" :loading="loading" @click="load">Обновить</Button>
			</template>
		</PageHeader>

		<Skeleton v-if="loading" variant="card" />

		<template v-else-if="rows.length">
			<div class="totals">
				<div class="tot"><b>{{ totals.free }}</b><span>свободных мест</span></div>
				<div class="tot"><b>{{ totals.beds }}</b><span>всего мест</span></div>
				<div class="tot"><b>{{ totals.arrivals }}</b><span>заездов сегодня</span></div>
				<div class="tot" :class="{ warn: totals.issues }"><b>{{ totals.issues }}</b><span>открытых заявок</span></div>
			</div>

			<div class="toolbar">
				<SegmentedControl v-model="filter" :options="filterOptions" />
				<Input v-model="q" placeholder="Поиск по названию или посёлку…" class="search" />
				<Select v-model="sort" style="width: auto" title="Порядок в списке">
					<option value="free">Больше свободных</option>
					<option value="load">Загруженнее</option>
					<option value="name">По названию</option>
				</Select>
				<div class="legend">
					<span class="leg"><StatusDot color="#1bd96a" /> есть места</span>
					<span class="leg"><StatusDot color="#ffa347" /> мало</span>
					<span class="leg"><StatusDot color="#ff496e" /> нет</span>
				</div>
			</div>

			<div class="map-grid">
				<Card pad="sm" class="map-card">
					<MapView
						v-if="withCoords.length"
						:markers="markers"
						:selected-id="selectedId"
						cluster
						height="max(440px, calc(100vh - 330px))"
						@select="selectedId = $event"
					/>
					<EmptyState v-else icon="map-pin" title="Нечего показать" text="Ни одна из подходящих гостиниц не имеет координат." />
				</Card>

				<div class="side">
					<Card v-if="selected" pad="md" class="selected">
						<div class="spread">
							<div>
								<div class="contrast selected__title">{{ selected.name }}</div>
								<div class="muted">{{ selected.settlement || selected.address || "Адрес не указан" }}</div>
							</div>
							<Chip :color="colorOf(selected)" dot>{{ labelOf(selected) }}</Chip>
						</div>

						<div class="bar" :title="`Занято ${selected.occupancy}%`">
							<span :style="{ width: selected.occupancy + '%', background: colorOf(selected) }" />
						</div>

						<div class="selected__stats">
							<div><b>{{ selected.free }}</b><span>свободно</span></div>
							<div><b>{{ selected.beds }}</b><span>мест всего</span></div>
							<div><b>{{ selected.rooms }}</b><span>номеров</span></div>
							<div><b>{{ selected.occupancy }}%</b><span>занято</span></div>
							<div><b>{{ selected.arrivals }}</b><span>заезды</span></div>
							<div><b>{{ selected.departures }}</b><span>выезды</span></div>
						</div>

						<div v-if="selected.repair || selected.issues" class="flags">
							<Chip v-if="selected.repair" color="var(--color-orange)" dot>на ремонте: {{ selected.repair }}</Chip>
							<Chip v-if="selected.issues" color="var(--color-red)" dot>заявок: {{ selected.issues }}</Chip>
						</div>

						<a v-if="selected.phone" :href="`tel:${selected.phone}`" class="phone"><Icon name="phone" size="0.9em" /> {{ selected.phone }}</a>

						<Button variant="primary" icon="calendar" class="rack-btn" @click="openRack(selected)">Открыть календарь броней</Button>
					</Card>

					<div class="list">
						<button
							v-for="r in visible"
							:key="r.id"
							type="button"
							class="hotel-row"
							:class="{ active: String(r.id) === String(selectedId) }"
							@click="selectedId = r.id"
						>
							<StatusDot :color="colorOf(r)" size="12px" />
							<span class="grow">
								<span class="contrast row-title">{{ r.name }}</span>
								<span class="muted row-sub">{{ r.settlement || r.address || "координаты не указаны" }}</span>
							</span>
							<span class="trail">
								<b class="contrast">{{ r.free }}</b><span class="muted">/{{ r.beds }}</span>
							</span>
						</button>
						<p v-if="!visible.length" class="muted empty-hint">Ничего не найдено — измените фильтр или запрос.</p>
					</div>
				</div>
			</div>
		</template>

		<Card v-else>
			<EmptyState icon="building" title="Гостиниц пока нет" text="Добавьте гостиницы и координаты, чтобы карта ожила." />
		</Card>

		<Card v-if="missing.length" pad="md">
			<div class="row" style="gap: var(--gap-sm)">
				<Icon name="info" style="color: var(--color-orange)" />
				<span class="muted">Без координат и не показаны на карте: <b class="contrast">{{ missing.map((m) => m.name).join(", ") }}</b>. Укажите широту и долготу в карточке гостиницы.</span>
			</div>
		</Card>
	</div>
</template>

<style scoped>
.totals {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: var(--gap-sm);
}
.tot {
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.tot b {
	display: block;
	color: var(--color-contrast);
	font-size: var(--font-size-xl);
	font-weight: 800;
	line-height: 1.1;
}
.tot span {
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.tot.warn b {
	color: var(--color-orange);
}
.toolbar {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.search {
	flex: 1;
	min-width: 200px;
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
.map-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 340px;
	gap: var(--gap-lg);
	align-items: start;
}
.map-card {
	padding: 0;
	overflow: hidden;
}
.side {
	display: grid;
	gap: var(--gap-sm);
	align-content: start;
}
.selected {
	background: var(--brand-gradient-bg), var(--color-raised-bg);
}
.selected__title {
	font-weight: 800;
}
.bar {
	height: 6px;
	border-radius: var(--radius-max);
	background: var(--color-bg);
	overflow: hidden;
	margin-top: var(--gap-md);
}
.bar span {
	display: block;
	height: 100%;
	border-radius: var(--radius-max);
}
.selected__stats {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: var(--gap-sm);
	margin-top: var(--gap-md);
}
.selected__stats div {
	padding: var(--gap-sm);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	text-align: center;
}
.selected__stats b {
	display: block;
	color: var(--color-contrast);
	font-size: var(--font-size-lg);
}
.selected__stats span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.flags {
	display: flex;
	gap: var(--gap-sm);
	flex-wrap: wrap;
	margin-top: var(--gap-md);
}
.phone {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-top: var(--gap-md);
	font-weight: 700;
}
.rack-btn {
	width: 100%;
	margin-top: var(--gap-md);
}
.list {
	display: grid;
	gap: var(--gap-xs);
	max-height: calc(100vh - 640px);
	min-height: 180px;
	overflow: auto;
	padding-right: 2px;
}
.hotel-row {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	width: 100%;
	text-align: left;
	font: inherit;
	cursor: pointer;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	color: var(--color-base);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.hotel-row:hover {
	border-color: var(--color-brand);
}
.hotel-row.active {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.row-title {
	display: block;
	font-weight: 700;
	font-size: var(--font-size-sm);
}
.row-sub {
	display: block;
	font-size: var(--font-size-xs);
}
.trail {
	white-space: nowrap;
	font-size: var(--font-size-sm);
}
.empty-hint {
	padding: var(--gap-md);
	text-align: center;
}
@media (max-width: 980px) {
	.map-grid {
		grid-template-columns: 1fr;
	}
	.list {
		max-height: none;
	}
}
</style>
