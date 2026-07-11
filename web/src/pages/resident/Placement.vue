<script setup>
import { ref, onMounted } from "vue"
import { useOverview } from "@/api/me"
import { amenityIcon } from "@/icons"
import { post } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import Gallery from "@/components/Gallery.vue"
import Modal from "@/components/Modal.vue"

const { overview, load } = useOverview()
const data = ref(null)
const stageLabel = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }

const isModalOpen = ref(false)
const selectedAmenity = ref(null)
const issueComment = ref("")
const isSending = ref(false)

onMounted(async () => {
	data.value = await load()
})

function reportIssue(amenity) {
	selectedAmenity.value = amenity
	issueComment.value = ""
	isModalOpen.value = true
}

async function sendIssue() {
	if (!issueComment.value.trim()) {
		toast("Пожалуйста, опишите проблему")
		return
	}
	isSending.value = true
	try {
		await post("/me/issues", {
			room_id: data.value.room.id,
			amenity_name: selectedAmenity.value.name,
			comment: issueComment.value.trim()
		})
		toast("Заявка на ремонт успешно отправлена!")
		isModalOpen.value = false
	} catch (e) {
		toast("Ошибка при отправке: " + e.message)
	} finally {
		isSending.value = false
	}
}
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
					<button
						v-for="a in data.room.amenities"
						:key="a.name"
						class="chip amenity clickable"
						title="Сообщить о поломке"
						@click="reportIssue(a)"
					>
						<Icon :name="amenityIcon(a.icon)" /> {{ a.name }}
					</button>
				</div>
				<p class="muted" v-else>Удобства не указаны.</p>
			</div>
		</template>

		<Modal v-if="isModalOpen" :title="'Поломка: ' + selectedAmenity?.name" @close="isModalOpen = false">
			<div class="grid" style="gap: var(--gap-sm)">
				<p style="margin: 0">Опишите, что случилось с элементом <b>{{ selectedAmenity?.name }}</b> в комнате № {{ data.placement.room_number }}:</p>
				<textarea v-model="issueComment" placeholder="Например: течет, не включается, шумит..." rows="3" style="width: 100%" :disabled="isSending" />
			</div>
			<template #foot>
				<button class="btn" :disabled="isSending" @click="isModalOpen = false">Отмена</button>
				<button class="btn btn-primary" :disabled="isSending" @click="sendIssue">
					{{ isSending ? 'Отправка...' : 'Сообщить мастеру' }}
				</button>
			</template>
		</Modal>
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
	background: var(--color-brand-highlight);
	border-radius: var(--radius-lg);
}
.room-no {
	font-size: 2.6rem;
	font-weight: 800;
	color: var(--color-brand);
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
.clickable { cursor: pointer; border: 1px solid var(--color-divider, #ccc); background: var(--color-bg, #fff); font-family: inherit; transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 6px; }
.clickable:hover { background: var(--color-red-bg, #fff5f5); border-color: var(--color-red, #ff5c5c); color: var(--color-red, #ff5c5c); transform: translateY(-1px); }
</style>
