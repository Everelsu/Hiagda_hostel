<script setup>
import { ref, onMounted } from "vue"
import { api } from "@/api/client"
import { amenityIcon, placeEmoji } from "@/icons"

const data = ref(null)
const loading = ref(true)
const error = ref("")

onMounted(async () => {
	try {
		data.value = await api("/me/overview")
	} catch (e) {
		error.value = e.message
	} finally {
		loading.value = false
	}
})

const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
function placeIcon(kind) {
	return placeEmoji[kind] || placeEmoji.default
}
</script>

<template>
	<div v-if="loading" class="muted">Загрузка…</div>
	<div v-else-if="error" class="card">{{ error }}</div>
	<div v-else class="grid">
		<h1>Здравствуйте, {{ data.resident?.full_name || "вахтовик" }}</h1>

		<div v-if="!data.placement" class="card">
			<p class="muted">На сегодня активного размещения не найдено. Обратитесь к коменданту.</p>
		</div>

		<template v-else>
			<div class="card placement">
				<div class="section-title">Моё размещение</div>
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
						<div class="spread">
							<span class="muted">Статус</span>
							<span class="chip" :style="{ background: data.placement.status_color, color: '#000' }">{{ data.placement.status_name }}</span>
						</div>
						<div class="spread"><span class="muted">Стадия</span> <b>{{ stageLabel[data.placement.stage] }}</b></div>
					</div>
				</div>
			</div>

			<div class="card">
				<div class="section-title">Что в номере</div>
				<p v-if="data.room?.description" class="muted" style="margin-top: 0">{{ data.room.description }}</p>
				<div v-if="data.room?.amenities?.length" class="amenities">
					<span v-for="a in data.room.amenities" :key="a.name" class="chip amenity">
						<span>{{ amenityIcon(a.icon) }}</span> {{ a.name }}
					</span>
				</div>
				<p v-else class="muted">Удобства не указаны.</p>
			</div>

			<div class="card">
				<div class="section-title">Соседи по комнате <span class="muted" style="font-weight: 400">({{ data.roommates.length }})</span></div>
				<p v-if="!data.roommates.length" class="muted">Вы живёте один.</p>
				<div v-else class="grid" style="gap: var(--gap-sm)">
					<div v-for="r in data.roommates" :key="r.id" class="roommate">
						<div class="avatar">{{ r.full_name.charAt(0) }}</div>
						<div class="grow">
							<div class="contrast" style="font-weight: 700">{{ r.full_name }}</div>
							<div class="muted" style="font-size: var(--font-size-sm)">
								{{ [r.position, r.company].filter(Boolean).join(" · ") || "—" }} · {{ r.bed_label }}
							</div>
							<div v-if="r.about" class="muted" style="font-size: var(--font-size-sm); margin-top: 2px">{{ r.about }}</div>
						</div>
					</div>
				</div>
			</div>

			<div class="card">
				<div class="section-title">О доме и посёлке</div>
				<p v-if="data.hotel?.description" style="margin-top: 0">{{ data.hotel.description }}</p>
				<div class="grid" style="gap: var(--gap-xs); margin-top: var(--gap-sm)">
					<div v-if="data.hotel?.settlement" class="spread"><span class="muted">Посёлок</span> <b>{{ data.hotel.settlement }}</b></div>
					<div v-if="data.hotel?.address" class="spread"><span class="muted">Адрес</span> <b>{{ data.hotel.address }}</b></div>
					<div v-if="data.hotel?.phone" class="spread"><span class="muted">Комендант</span> <b>{{ data.hotel.phone }}</b></div>
				</div>

				<div v-if="data.hotel?.amenities?.length" class="amenities" style="margin-top: var(--gap-md)">
					<span v-for="a in data.hotel.amenities" :key="a.name" class="chip amenity">
						<span>{{ amenityIcon(a.icon) }}</span> {{ a.name }}
					</span>
				</div>

				<template v-if="data.hotel?.places?.length">
					<div class="section-title" style="font-size: var(--font-size-nm); margin-top: var(--gap-lg)">Что рядом</div>
					<div class="grid" style="gap: var(--gap-sm)">
						<div v-for="p in data.hotel.places" :key="p.id" class="place">
							<span class="place-ico">{{ placeIcon(p.kind) }}</span>
							<div class="grow">
								<div class="contrast" style="font-weight: 700">{{ p.name }} <span v-if="p.distance" class="muted" style="font-weight: 400">· {{ p.distance }}</span></div>
								<div v-if="p.note" class="muted" style="font-size: var(--font-size-sm)">{{ p.note }}</div>
							</div>
						</div>
					</div>
				</template>

				<template v-if="data.hotel?.rules">
					<div class="section-title" style="font-size: var(--font-size-nm); margin-top: var(--gap-lg)">Правила</div>
					<p class="muted" style="margin: 0; white-space: pre-line">{{ data.hotel.rules }}</p>
				</template>
			</div>
		</template>
	</div>
</template>

<style scoped>
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
.roommate,
.place {
	display: flex;
	gap: var(--gap-md);
	align-items: center;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.avatar {
	width: 2.4rem;
	height: 2.4rem;
	border-radius: var(--radius-max);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	display: grid;
	place-items: center;
	font-weight: 800;
	flex-shrink: 0;
}
.place-ico {
	font-size: 1.4rem;
}
</style>
