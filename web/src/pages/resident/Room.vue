<script setup>
import { ref, onMounted, computed } from "vue"
import { post } from "@/api/client"
import { toast } from "@/toast"
import { useOverview, loadFeed } from "@/api/me"
import { amenityIcon } from "@/icons"
import Icon from "@/components/Icon.vue"
import Gallery from "@/components/Gallery.vue"
import Stars from "@/components/Stars.vue"
import Modal from "@/components/Modal.vue"
import { PageHeader, Card, Avatar, EmptyState, Button, Textarea } from "@/ui"

const { load } = useOverview()
const data = ref(null)
const loading = ref(true)

// Заявка о поломке прямо с плитки удобства
const broken = ref(null)
const comment = ref("")
const sending = ref(false)

// Отзыв о номере (отдельно от отзыва о доме)
const rating = ref(0)
const reviewText = ref("")
const savingReview = ref(false)

const room = computed(() => data.value?.room || null)
const pl = computed(() => data.value?.placement || null)
const roommates = computed(() => data.value?.roommates || [])

async function refresh(force = false) {
	data.value = await load(force)
	rating.value = data.value?.my_room_review?.rating || 0
	reviewText.value = data.value?.my_room_review?.text || ""
}
onMounted(async () => {
	try {
		await refresh()
	} finally {
		loading.value = false
	}
})

function openBroken(amenity) {
	broken.value = amenity
	comment.value = ""
}
async function sendIssue() {
	if (!comment.value.trim()) return toast.error("Опишите, что случилось")
	sending.value = true
	try {
		await post("/me/issues", { room_id: room.value.id, amenity_name: broken.value?.name || null, comment: comment.value.trim() })
		broken.value = null
		toast.success("Заявка отправлена коменданту")
		loadFeed(true).catch(() => {})
		refresh(true)
	} catch (e) {
		toast.error(e.message)
	} finally {
		sending.value = false
	}
}

async function saveReview() {
	if (!rating.value) return toast.error("Поставьте оценку")
	savingReview.value = true
	try {
		await post("/me/review", { target: "room", rating: rating.value, text: reviewText.value })
		await refresh(true)
		toast.success("Спасибо за отзыв о номере")
	} catch (e) {
		toast.error(e.message)
	} finally {
		savingReview.value = false
	}
}

function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { dateStyle: "medium" }) : ""
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Мой номер" icon="bed" back="/me" />

		<Card v-if="loading"><EmptyState icon="bed" text="Загрузка…" /></Card>
		<Card v-else-if="!room"><EmptyState icon="bed" title="Номер не назначен" text="Активного размещения нет — обратитесь к коменданту." /></Card>

		<template v-else>
			<!-- Паспорт номера -->
			<section class="room-head">
				<div class="room-badge">
					<span class="room-no">№&nbsp;{{ room.number }}</span>
					<span class="room-bed">{{ pl?.bed_label }}</span>
				</div>
				<dl class="specs">
					<div><dt>Дом</dt><dd>{{ pl?.hotel_name }}</dd></div>
					<div v-if="room.floor != null"><dt>Этаж</dt><dd>{{ room.floor }}</dd></div>
					<div v-if="room.class_name"><dt>Тип</dt><dd>{{ room.class_name }}</dd></div>
					<div><dt>Мест в номере</dt><dd>{{ room.capacity }}</dd></div>
				</dl>
			</section>

			<p v-if="room.description" class="room-desc">{{ room.description }}</p>

			<router-link to="/me/plan" class="plan-link">
				<Icon name="layout" />
				<span><b>Где мой номер</b>схема этажа: душевая, кухня, выход</span>
				<Icon name="chevron-right" />
			</router-link>

			<Gallery v-if="room.images?.length" :images="room.images" />

			<!-- Удобства: тап по плитке = сообщить о поломке -->
			<section>
				<div class="sec-head">
					<h2 class="sec"><Icon name="wrench" /> Что в номере</h2>
					<span class="muted hint">Нажмите на то, что сломалось</span>
				</div>
				<div v-if="room.amenities?.length" class="amenities">
					<button v-for="a in room.amenities" :key="a.name" type="button" class="amenity" @click="openBroken(a)">
						<Icon :name="amenityIcon(a.icon)" size="1.3rem" />
						<span>{{ a.name }}</span>
						<Icon name="wrench" size="0.85rem" class="amenity-fix" />
					</button>
				</div>
				<Card v-else><EmptyState icon="dot" text="Удобства не указаны" /></Card>

				<router-link v-if="room.open_issues" to="/me/issues" class="open-issues">
					<Icon name="info" /> По номеру открыто заявок: <b>{{ room.open_issues }}</b> — посмотреть
				</router-link>
			</section>

			<!-- Соседи -->
			<section>
				<h2 class="sec"><Icon name="users" /> Соседи по комнате</h2>
				<Card v-if="!roommates.length"><EmptyState icon="users" title="Вы живёте один" text="Других жильцов в комнате сейчас нет" /></Card>
				<div v-else class="mates">
					<div v-for="r in roommates" :key="r.id" class="mate">
						<Avatar :src="r.photo" :name="r.full_name" size="2.6rem" />
						<div class="grow">
							<div class="mate-name">{{ r.full_name }}</div>
							<div class="muted mate-sub">{{ [r.position, r.company].filter(Boolean).join(" · ") || "—" }} · {{ r.bed_label }}</div>
							<p v-if="r.about" class="mate-about">{{ r.about }}</p>
						</div>
						<a v-if="r.phone" :href="`tel:${r.phone}`" class="mate-call" title="Позвонить"><Icon name="phone" /></a>
					</div>
				</div>
			</section>

			<!-- Отзыв именно о номере -->
			<Card class="review-card" stack>
				<div class="sec-head">
					<h2 class="sec" style="margin: 0"><Icon name="message-square" /> {{ data.my_room_review ? "Мой отзыв о номере" : "Оценить номер" }}</h2>
					<span v-if="room.rating" class="muted hint"><Stars :model-value="room.rating" readonly /> {{ room.rating }} ({{ room.reviews_count }})</span>
				</div>
				<p class="muted review-hint">Оценка номера помогает коменданту понять, где нужен ремонт. Отзыв о доме целиком — на вкладке «Дом».</p>
				<Stars v-model="rating" size="1.8rem" />
				<Textarea v-model="reviewText" :rows="3" placeholder="Что не так с номером или что хорошо" />
				<Button variant="primary" :loading="savingReview" @click="saveReview">{{ data.my_room_review ? "Обновить отзыв" : "Отправить" }}</Button>

				<div v-if="data.my_room_review?.reply" class="reply">
					<div class="row" style="gap: var(--gap-sm)">
						<Icon name="message-square" style="color: var(--color-brand)" />
						<b class="contrast">Ответ администрации</b>
						<span class="muted" style="font-size: var(--font-size-xs)">{{ fmt(data.my_room_review.reply_at) }}</span>
					</div>
					<p class="reply-body">{{ data.my_room_review.reply }}</p>
				</div>
			</Card>
		</template>

		<Modal v-if="broken" :title="`Сломалось: ${broken.name}`" @close="broken = null">
			<p style="margin: 0 0 var(--gap-sm)">Опишите, что случилось — заявка уйдёт коменданту.</p>
			<Textarea v-model="comment" :rows="3" placeholder="Например: не включается, течёт, шумит" :disabled="sending" />
			<template #foot>
				<Button variant="ghost" :disabled="sending" @click="broken = null">Отмена</Button>
				<Button variant="primary" :loading="sending" @click="sendIssue">Отправить</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.room-head {
	display: flex;
	align-items: center;
	gap: var(--gap-lg);
	flex-wrap: wrap;
	padding: var(--gap-lg);
	background: var(--brand-gradient-bg), var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
}
.room-badge {
	display: grid;
	place-items: center;
	gap: 2px;
	padding: var(--gap-md) var(--gap-lg);
	background: var(--color-brand-highlight);
	border-radius: var(--radius-lg);
	min-width: 116px;
}
.room-no {
	font-size: 2rem;
	font-weight: 800;
	color: var(--color-brand);
	line-height: 1.05;
	white-space: nowrap;
}
.room-bed {
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.specs {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
	gap: var(--gap-md);
	margin: 0;
	flex: 1;
	min-width: 180px;
}
.specs dt {
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.specs dd {
	margin: 2px 0 0;
	color: var(--color-contrast);
	font-weight: 700;
}
.room-desc {
	margin: 0;
	color: var(--color-secondary);
}
.plan-link {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	color: var(--color-base);
}
.plan-link:hover {
	border-color: var(--color-brand);
}
.plan-link :deep(svg) {
	color: var(--color-brand);
	flex-shrink: 0;
}
.plan-link span {
	flex: 1;
	font-size: var(--font-size-sm);
}
.plan-link b {
	display: block;
	color: var(--color-contrast);
}
.sec-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--gap-sm);
	flex-wrap: wrap;
	margin-bottom: var(--gap-sm);
}
.sec {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	margin: 0;
	font-size: var(--font-size-md);
	color: var(--color-contrast);
}
.hint {
	font-size: var(--font-size-xs);
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.amenities {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: var(--gap-sm);
}
.amenity {
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	font: inherit;
	text-align: left;
	cursor: pointer;
	color: var(--color-base);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.amenity :deep(svg):first-child {
	color: var(--color-brand);
	flex-shrink: 0;
}
.amenity span {
	flex: 1;
	font-size: var(--font-size-sm);
	font-weight: 600;
}
.amenity-fix {
	opacity: 0;
	color: var(--color-orange);
}
.amenity:hover {
	border-color: var(--color-orange);
	color: var(--color-orange);
}
.amenity:hover .amenity-fix {
	opacity: 1;
}
.open-issues {
	display: inline-flex;
	align-items: center;
	gap: var(--gap-sm);
	margin-top: var(--gap-sm);
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-size: var(--font-size-sm);
	font-weight: 600;
}
.mates {
	display: grid;
	gap: var(--gap-sm);
}
.mate {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.mate-name {
	font-weight: 700;
	color: var(--color-contrast);
}
.mate-sub {
	font-size: var(--font-size-xs);
}
.mate-about {
	margin: 4px 0 0;
	font-size: var(--font-size-sm);
}
.mate-call {
	display: grid;
	place-items: center;
	width: 2.2rem;
	height: 2.2rem;
	border-radius: var(--radius-max);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	flex-shrink: 0;
}
.review-hint {
	margin: 0;
	font-size: var(--font-size-sm);
}
.reply {
	margin-top: var(--gap-sm);
	padding: var(--gap-md);
	background: var(--color-brand-highlight);
	border-radius: var(--radius-md);
}
.reply-body {
	margin: var(--gap-xs) 0 0;
	white-space: pre-wrap;
}
@media (max-width: 560px) {
	.room-badge {
		min-width: 96px;
	}
	.room-no {
		font-size: 1.6rem;
	}
	.amenity-fix {
		opacity: 1;
	}
}
</style>
