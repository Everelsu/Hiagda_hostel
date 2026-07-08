<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import MapView from "@/components/MapView.vue"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Chip, ListRow, StatusDot, Skeleton } from "@/ui"

const rows = ref([])
const loading = ref(true)

onMounted(async () => {
	try {
		rows.value = await api("/map")
	} finally {
		loading.value = false
	}
})

function color(o) {
	return o >= 95 ? "#ff496e" : o >= 70 ? "#ffa347" : "#1bd96a"
}

const withCoords = computed(() => rows.value.filter((r) => r.latitude != null && r.longitude != null))
const missing = computed(() => rows.value.filter((r) => r.latitude == null || r.longitude == null))

const markers = computed(() =>
	withCoords.value.map((r) => ({
		id: r.id,
		lat: r.latitude,
		lng: r.longitude,
		color: color(r.occupancy),
		html: `<b>${r.name}</b><br>${r.settlement || ""}<br>Свободно <b>${r.free}</b> из ${r.beds} · заезды: ${r.arrivals}${r.repair ? `<br>На ремонте номеров: ${r.repair}` : ""}`,
	})),
)
</script>

<template>
	<div class="grid">
		<PageHeader title="Карта посёлков" icon="map">
			<template #actions>
				<Chip color="#1bd96a" dot>свободно</Chip>
				<Chip color="#ffa347" dot>заполнено</Chip>
				<Chip color="#ff496e" dot>нет мест</Chip>
			</template>
		</PageHeader>

		<Skeleton v-if="loading" variant="card" />
		<div v-else class="map-grid">
			<MapView :markers="markers" height="560px" />
			<div class="grid" style="gap: var(--gap-sm); align-content: start">
				<ListRow v-for="r in rows" :key="r.id">
					<template #lead><StatusDot :color="color(r.occupancy)" size="12px" /></template>
					<template #title>{{ r.name }}</template>
					<template #sub>{{ r.settlement || r.address || "—" }}</template>
					<template #trail>
						<div style="text-align: right">
							<div class="contrast" style="font-weight: 700">{{ r.free }}<span class="muted">/{{ r.beds }}</span></div>
							<div class="muted" style="font-size: var(--font-size-xs)">{{ r.occupancy }}% занято</div>
						</div>
					</template>
				</ListRow>
			</div>
		</div>

		<Card v-if="missing.length" pad="md">
			<div class="row" style="gap: var(--gap-sm)">
				<Icon name="info" style="color: var(--color-orange)" />
				<span class="muted">Без координат (не показаны на карте): <b class="contrast">{{ missing.map((m) => m.name).join(", ") }}</b>. Укажите широту и долготу в карточке гостиницы.</span>
			</div>
		</Card>
	</div>
</template>

<style scoped>
.map-grid {
	display: grid;
	grid-template-columns: 1fr 320px;
	gap: var(--gap-lg);
	align-items: start;
}
@media (max-width: 900px) {
	.map-grid {
		grid-template-columns: 1fr;
	}
}
</style>
