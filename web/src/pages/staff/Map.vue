<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import MapView from "@/components/MapView.vue"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Chip, ListRow, StatusDot, Skeleton, EmptyState, Button } from "@/ui"

const rows = ref([])
const loading = ref(true)
const selectedId = ref(null)

async function load() {
	loading.value = true
	try {
		rows.value = await api("/map")
		if (!selectedId.value && rows.value.length) selectedId.value = rows.value.find((r) => r.latitude != null && r.longitude != null)?.id || rows.value[0].id
	} finally {
		loading.value = false
	}
}
onMounted(load)

function color(occupancy) {
	return occupancy >= 95 ? "#ff496e" : occupancy >= 70 ? "#ffa347" : "#1bd96a"
}
function statusLabel(occupancy) {
	if (occupancy >= 95) return "нет мест"
	if (occupancy >= 70) return "плотно"
	return "есть места"
}
function popup(row) {
	return `
		<b>${row.name}</b><br>
		${row.settlement || row.address || "Без адреса"}<br>
		Свободно <b>${row.free}</b> из ${row.beds} мест · ${row.occupancy}% занято
		${row.arrivals ? `<br>Заезды сегодня: ${row.arrivals}` : ""}
		${row.repair ? `<br>На ремонте номеров: ${row.repair}` : ""}
	`
}

const withCoords = computed(() => rows.value.filter((r) => r.latitude != null && r.longitude != null))
const missing = computed(() => rows.value.filter((r) => r.latitude == null || r.longitude == null))
const selected = computed(() => rows.value.find((r) => String(r.id) === String(selectedId.value)))
const markers = computed(() =>
	withCoords.value.map((r) => ({
		id: r.id,
		lat: r.latitude,
		lng: r.longitude,
		color: color(r.occupancy),
		title: r.name,
		html: popup(r),
	})),
)
</script>

<template>
	<div class="grid">
		<PageHeader title="Карта размещения" subtitle="Гостиницы, свободные места и заезды по посёлкам" icon="map">
			<template #actions>
				<Chip color="#1bd96a" dot>есть места</Chip>
				<Chip color="#ffa347" dot>плотно</Chip>
				<Chip color="#ff496e" dot>нет мест</Chip>
				<Button icon="rotate-cw" :loading="loading" @click="load">Обновить</Button>
			</template>
		</PageHeader>

		<Skeleton v-if="loading" variant="card" />
		<div v-else-if="rows.length" class="map-grid">
			<Card pad="sm" class="map-card">
				<MapView :markers="markers" :selected-id="selectedId" height="560px" @select="selectedId = $event" />
			</Card>

			<div class="side">
				<Card v-if="selected" pad="md" class="selected">
					<div class="spread">
						<div>
							<div class="contrast selected__title">{{ selected.name }}</div>
							<div class="muted">{{ selected.settlement || selected.address || "Адрес не указан" }}</div>
						</div>
						<Chip :color="color(selected.occupancy)" dot>{{ statusLabel(selected.occupancy) }}</Chip>
					</div>
					<div class="selected__stats">
						<div><b>{{ selected.free }}</b><span>свободно</span></div>
						<div><b>{{ selected.beds }}</b><span>мест</span></div>
						<div><b>{{ selected.arrivals }}</b><span>заезды</span></div>
						<div><b>{{ selected.repair }}</b><span>ремонт</span></div>
					</div>
				</Card>

				<div class="list">
					<ListRow v-for="r in rows" :key="r.id" class="hotel-row" :class="{ active: String(r.id) === String(selectedId) }" @click="selectedId = r.id">
						<template #lead><StatusDot :color="color(r.occupancy)" size="12px" /></template>
						<template #title>{{ r.name }}</template>
						<template #sub>{{ r.settlement || r.address || "координаты не указаны" }}</template>
						<template #trail>
							<div class="trail">
								<div class="contrast">{{ r.free }}<span class="muted">/{{ r.beds }}</span></div>
								<div class="muted">{{ r.occupancy }}%</div>
							</div>
						</template>
					</ListRow>
				</div>
			</div>
		</div>
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
.selected__stats {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: var(--gap-sm);
	margin-top: var(--gap-md);
}
.selected__stats div {
	padding: var(--gap-sm);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
}
.selected__stats b {
	display: block;
	color: var(--color-contrast);
	font-size: var(--font-size-lg);
}
.selected__stats span,
.trail {
	font-size: var(--font-size-xs);
}
.list {
	display: grid;
	gap: var(--gap-sm);
	max-height: 410px;
	overflow: auto;
	padding-right: 2px;
}
.hotel-row {
	cursor: pointer;
	border: 1px solid transparent;
	border-radius: var(--radius-md);
}
.hotel-row.active {
	border-color: var(--color-brand);
	background: var(--color-brand-highlight);
}
.trail {
	text-align: right;
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
