<script setup>
import { ref, onMounted, computed } from "vue"
import { useRouter } from "vue-router"
import { loadFeed, feed, markAnnouncementsSeen } from "@/api/me"
import Icon from "@/components/Icon.vue"

const router = useRouter()
const loading = ref(true)

onMounted(async () => {
	try {
		await loadFeed(true)
		markAnnouncementsSeen()
	} finally {
		loading.value = false
	}
})

const pl = computed(() => feed.value?.placement || null)
const announcements = computed(() => feed.value?.announcements || [])
const openIssues = computed(() => (feed.value?.issues || []).filter((i) => i.status !== "Починено"))
const name = computed(() => feed.value?.resident?.full_name?.split(" ")[1] || feed.value?.resident?.full_name || "вахтовик")

const STATUS_COLOR = { Новая: "var(--color-red)", "В работе": "var(--color-orange)", Починено: "var(--color-green)" }
const stageLabel = { expected: "Ожидается заезд", checked_in: "Вы проживаете", checked_out: "Выехали", cancelled: "Отменено" }

const daysLeft = computed(() => {
	if (!pl.value?.date_to) return null
	const d = Math.ceil((new Date(pl.value.date_to) - new Date()) / 86400000)
	return d
})
function fmtDate(d) {
	return d ? new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : ""
}
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : ""
}
</script>

<template>
	<div class="grid">
		<div>
			<h1>Здравствуйте, {{ name }}</h1>
			<p class="muted" style="margin-top: 2px">Всё про ваше проживание — в одном месте</p>
		</div>

		<div v-if="loading" class="muted">Загрузка…</div>

		<template v-else>
			<router-link v-if="pl" to="/me/hotel" class="card placement">
				<div class="big-room">
					<div class="room-no">№ {{ pl.room_number }}</div>
					<div class="bed">{{ pl.bed_label }}</div>
				</div>
				<div class="grow grid" style="gap: 4px; align-content: center">
					<div class="contrast" style="font-weight: 700; font-size: var(--font-size-lg)">{{ pl.hotel_name }}</div>
					<div class="muted" style="font-size: var(--font-size-sm)">{{ pl.hotel_settlement || "" }}</div>
					<div class="chip" style="width: fit-content; margin-top: 4px" :style="{ background: pl.status_color, color: '#000', borderColor: 'transparent' }">
						{{ stageLabel[pl.stage] || pl.status_name }}
					</div>
				</div>
				<div class="stay">
					<div class="muted" style="font-size: var(--font-size-xs)">{{ fmtDate(pl.date_from) }} – {{ fmtDate(pl.date_to) }}</div>
					<div v-if="daysLeft != null && daysLeft >= 0" class="days"><b>{{ daysLeft }}</b> <span class="muted">дн. до выезда</span></div>
				</div>
			</router-link>
			<div v-else class="card"><p class="muted" style="margin: 0">На сегодня активного размещения нет. Обратитесь к коменданту.</p></div>

			<section v-if="announcements.length">
				<div class="section-title"><Icon name="megaphone" /> Объявления</div>
				<div class="grid" style="gap: var(--gap-sm)">
					<div v-for="a in announcements" :key="a.id" class="card card-pad-sm">
						<div class="row" style="gap: var(--gap-sm)">
							<Icon v-if="a.pinned" name="pin" style="color: var(--color-brand)" />
							<span class="contrast" style="font-weight: 700">{{ a.title }}</span>
							<span class="grow" />
							<span class="muted" style="font-size: var(--font-size-xs)">{{ fmt(a.created_at) }}</span>
						</div>
						<p style="margin: var(--gap-xs) 0 0; white-space: pre-wrap">{{ a.body }}</p>
					</div>
				</div>
			</section>

			<section v-if="openIssues.length">
				<div class="section-title"><Icon name="wrench" /> Мои заявки</div>
				<router-link v-for="i in openIssues" :key="i.id" to="/me/issues" class="card card-pad-sm issue-row">
					<span class="dot" :style="{ background: STATUS_COLOR[i.status] }" />
					<div class="grow">
						<div class="contrast" style="font-weight: 600; font-size: var(--font-size-sm)">{{ i.amenity_name || "Заявка" }} · № {{ i.room_number }}</div>
						<div class="muted" style="font-size: var(--font-size-xs)">{{ i.comment }}</div>
					</div>
					<span class="chip" :style="{ color: STATUS_COLOR[i.status], borderColor: STATUS_COLOR[i.status] }">{{ i.status }}</span>
				</router-link>
			</section>

			<div class="actions">
				<button class="btn btn-brand" @click="router.push('/me/issues')"><Icon name="wrench" /> Сообщить о проблеме</button>
				<button class="btn btn-brand" @click="router.push('/me/hotel')"><Icon name="building" /> О доме</button>
			</div>
		</template>
	</div>
</template>

<style scoped>
.placement {
	display: flex;
	gap: var(--gap-lg);
	align-items: center;
	color: var(--color-base);
	flex-wrap: wrap;
}
.placement:hover {
	border-color: var(--color-brand);
}
.big-room {
	text-align: center;
	padding: var(--gap-md) var(--gap-lg);
	background: var(--color-green-bg);
	border-radius: var(--radius-lg);
	min-width: 120px;
}
.room-no {
	font-size: 2.2rem;
	font-weight: 800;
	color: var(--color-green);
	line-height: 1.1;
}
.bed {
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.stay {
	text-align: right;
}
.days {
	font-size: var(--font-size-sm);
}
.days b {
	font-size: var(--font-size-lg);
	color: var(--color-contrast);
}
.issue-row {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	color: var(--color-base);
	margin-bottom: var(--gap-sm);
}
.issue-row .dot {
	width: 10px;
	height: 10px;
	border-radius: var(--radius-max);
	flex-shrink: 0;
}
.actions {
	display: flex;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.actions .btn {
	flex: 1;
	min-width: 160px;
}
@media (max-width: 520px) {
	.placement {
		flex-direction: column;
		align-items: stretch;
	}
	.stay {
		text-align: left;
	}
}
</style>
