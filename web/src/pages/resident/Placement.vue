<script setup>
import { ref, onMounted } from "vue"
import { useOverview } from "@/api/me"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import Gallery from "@/components/Gallery.vue"

const { overview, load } = useOverview()
const data = ref(null)
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
onMounted(async () => {
	data.value = await load()
})
</script>

<template>
	<div class="grid" v-if="data">
		<router-link to="/me" class="back">‹ Назад</router-link>
		<h1>Моё размещение</h1>

		<div v-if="!data.placement" class="card"><p class="muted">На сегодня активного размещения не найдено. Обратитесь к коменданту.</p></div>

		<template v-else>
			<div class="card">
				<div class="placement-grid">
					<div class="big-room">
						<div class="muted">Номер</div>
						<div class="room-no">№ {{ data.placement.room_number }}</div>
						<div class="muted">{{ data.placement.bed_label }}</div>
					</div>
					<div class="grow grid" style="gap: var(--gap-sm); align-content: start">
						<div class="spread"><span class="muted">Дом</span> <b>{{ data.hotel?.name }}</b></div>
						<div v-if="data.placement.floor != null" class="spread"><span class="muted">Этаж</span> <b>{{ data.placement.floor }}</b></div>
						<div v-if="data.room?.class_name" class="spread"><span class="muted">Тип</span> <b>{{ data.room.class_name }}</b></div>
						<div class="spread"><span class="muted">Период</span> <b>{{ data.placement.date_from }} – {{ data.placement.date_to }}</b></div>
						<div class="spread"><span class="muted">Статус</span> <span class="chip" :style="{ background: data.placement.status_color, color: '#000' }">{{ data.placement.status_name }}</span></div>
						<div class="spread"><span class="muted">Стадия</span> <b>{{ stageLabel[data.placement.stage] }}</b></div>
					</div>
				</div>
			</div>

			<Gallery v-if="data.room?.images?.length" :images="data.room.images" />

			<div class="card">
				<div class="section-title">Что в номере</div>
				<p v-if="data.room?.description" class="muted" style="margin-top: 0">{{ data.room.description }}</p>
				<div v-if="data.room?.amenities?.length" class="amenities">
					<span v-for="a in data.room.amenities" :key="a.name" class="chip amenity"><Icon :name="amenityIcon(a.icon)" /> {{ a.name }}</span>
				</div>
				<p v-else class="muted">Удобства не указаны.</p>
			</div>
		</template>
	</div>
</template>

<style scoped>
.back {
	font-weight: 700;
	color: var(--color-secondary);
}
.placement-grid {
	display: flex;
	gap: var(--gap-xl);
	flex-wrap: wrap;
}
.big-room {
	text-align: center;
	padding: var(--gap-md) var(--gap-xl);
	background: var(--color-green-bg);
	border-radius: var(--radius-lg);
}
.room-no {
	font-size: 2.6rem;
	font-weight: 800;
	color: var(--color-green);
	line-height: 1.1;
}
.amenities {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-sm);
	margin-top: var(--gap-sm);
}
.amenity {
	font-weight: var(--font-weight-medium);
	font-size: var(--font-size-sm);
}
</style>
