<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import FloorPlan from "@/components/FloorPlan.vue"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, EmptyState, SegmentedControl } from "@/ui"

const data = ref(null)
const loading = ref(true)

onMounted(async () => {
	try {
		data.value = await api("/me/plan")
	} finally {
		loading.value = false
	}
})

// Вахтовику не нужна занятость соседей — только «мой номер» и ориентиры
const planRooms = computed(() =>
	(data.value?.rooms || []).map((r) => ({
		...r,
		tone: "plain",
		highlight: r.id === data.value.my_room_id,
		label: "№ " + r.number,
	})),
)
// Номер может быть ещё не размещён на схеме — честно предупреждаем, а не молчим
const myRoomOnPlan = computed(() => planRooms.value.some((r) => r.highlight))
// Схема и/или фото (план эвакуации): если есть только фото — показываем его
const hasScheme = computed(() => !!(data.value?.rooms?.length || data.value?.shapes?.length))
const showPhoto = ref(false)
const VIEW = [
	{ value: false, label: "Схема" },
	{ value: true, label: "План эвакуации / фото" },
]
</script>

<template>
	<div class="grid">
		<PageHeader title="План этажа" icon="layout" back="/me/place#floor" />

		<div v-if="loading" class="res-skel"><span /><span /><span /></div>
		<Card v-else-if="!data?.available">
			<EmptyState icon="layout" title="Плана пока нет" text="Комендант ещё не начертил схему этажа для этого дома." />
		</Card>

		<template v-else>
			<div class="head">
				<div>
					<b class="contrast">{{ data.hotel_name }}</b>
					<span class="muted"> · {{ data.floor }} этаж</span>
				</div>
				<span v-if="myRoomOnPlan" class="you"><span class="swatch" /> ваш номер № {{ data.my_room_number }}</span>
			</div>

			<SegmentedControl v-if="hasScheme && data.image" v-model="showPhoto" :options="VIEW" />

			<a v-if="data.image && (showPhoto || !hasScheme)" :href="data.image" target="_blank" rel="noopener" class="photo">
				<img :src="data.image" alt="План этажа" />
				<span class="muted">Нажмите, чтобы открыть крупно</span>
			</a>
			<template v-else>
			<div v-if="!myRoomOnPlan" class="notice">
				<Icon name="info" />
				<span>Ваш номер <b>№ {{ data.my_room_number }}</b> ещё не отмечен на схеме — комендант его не разместил. Ориентиры ниже показаны верно.</span>
			</div>

			<FloorPlan :rooms="planRooms" :shapes="data.shapes" />

			<p class="muted hint"><Icon name="info" size="0.9rem" /> Схема показывает, где ваш номер и что находится рядом — душевая, кухня, лестница, выход.</p>
			</template>
		</template>
	</div>
</template>

<style scoped>
.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
	flex-wrap: wrap;
}
.you {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: var(--font-size-sm);
	font-weight: 700;
	color: var(--color-brand);
}
.swatch {
	width: 14px;
	height: 14px;
	border-radius: 4px;
	background: color-mix(in srgb, var(--color-brand), transparent 55%);
	border: 2px solid var(--color-brand);
}
.notice {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-orange);
	border-radius: var(--radius-md);
	font-size: var(--font-size-sm);
}
.notice :deep(svg) {
	color: var(--color-orange);
	flex-shrink: 0;
}
.photo {
	display: grid;
	gap: 6px;
	justify-items: center;
	font-size: var(--font-size-xs);
}
.photo img {
	width: 100%;
	border-radius: var(--radius-md);
	background: #fff;
	border: 1px solid var(--color-divider);
}
.hint {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: var(--font-size-xs);
	margin: 0;
}
</style>
