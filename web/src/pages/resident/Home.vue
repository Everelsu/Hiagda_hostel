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
const stay = computed(() => feed.value?.stay || null)
const hotel = computed(() => feed.value?.hotel || null)
const announcements = computed(() => feed.value?.announcements || [])
const openIssues = computed(() => (feed.value?.issues || []).filter((i) => i.status !== "Починено"))
const fullName = computed(() => feed.value?.resident?.full_name || "")
// Обращение по имени: «Иванов Иван Петрович» → «Иван»
const name = computed(() => fullName.value.split(" ")[1] || fullName.value || "вахтовик")

const STATUS_COLOR = { Новая: "var(--color-red)", "В работе": "var(--color-orange)", Починено: "var(--color-green)" }

// Главный посыл карточки зависит от стадии: ждём заезда / живёте / выехали
const headline = computed(() => {
	const s = stay.value
	if (!s || !pl.value) return null
	if (pl.value.stage === "checked_out" || s.finished) return { kind: "done", top: "Вахта завершена", big: "—", sub: "" }
	if (!s.started) {
		const inDays = Math.abs(Math.round((new Date(s.date_from) - new Date()) / 86400000))
		return { kind: "soon", top: "До заезда", big: String(inDays), sub: declDays(inDays) }
	}
	return { kind: "live", top: "До выезда", big: String(Math.max(0, s.days_left)), sub: declDays(Math.max(0, s.days_left)) }
})

function declDays(n) {
	const a = Math.abs(n) % 100
	const b = a % 10
	if (a > 10 && a < 20) return "дней"
	if (b === 1) return "день"
	if (b >= 2 && b <= 4) return "дня"
	return "дней"
}
function fmtShort(d) {
	return d ? new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : ""
}
function fmtLong(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : ""
}
</script>

<template>
	<div class="grid">
		<div v-if="loading" class="skeleton-hero" />

		<template v-else>
			<h1 class="hello">Здравствуйте, {{ name }}</h1>

			<!-- Где я живу и сколько осталось -->
			<section v-if="pl" class="stay-card">
				<div class="stay-top">
					<div class="room-badge">
						<span class="room-no">№&nbsp;{{ pl.room_number }}</span>
						<span class="room-bed">{{ pl.bed_label }}</span>
					</div>
					<div class="stay-where">
						<div class="house">{{ pl.hotel_name }}</div>
						<div class="muted place">
							{{ pl.hotel_settlement || "" }}<template v-if="pl.floor != null"> · этаж {{ pl.floor }}</template>
						</div>
						<div class="dates">{{ fmtShort(pl.date_from) }} – {{ fmtShort(pl.date_to) }}</div>
					</div>
					<div v-if="headline" class="countdown" :class="headline.kind">
						<span class="cd-top">{{ headline.top }}</span>
						<span class="cd-big">{{ headline.big }}</span>
						<span class="cd-sub">{{ headline.sub }}</span>
					</div>
				</div>

				<div v-if="stay && stay.started && !stay.finished" class="progress">
					<div class="progress-bar"><span :style="{ width: stay.percent + '%' }" /></div>
					<div class="progress-legend muted">День {{ stay.day_number }} из {{ stay.total_days }}</div>
				</div>
			</section>

			<section v-else class="card empty-stay">
				<Icon name="info" size="1.4rem" />
				<div>
					<b class="contrast">Активного размещения нет</b>
					<p class="muted">Обратитесь к коменданту — он оформит заселение.</p>
				</div>
			</section>

			<!-- Дежурные сведения: куда звонить и во сколько выезжать -->
			<section v-if="hotel" class="facts">
				<a v-if="hotel.phone" :href="`tel:${hotel.phone}`" class="fact">
					<Icon name="phone" />
					<span><b>Комендант</b>{{ hotel.phone }}</span>
				</a>
				<div v-if="hotel.check_out" class="fact">
					<Icon name="clock" />
					<span><b>Выезд до</b>{{ hotel.check_out }}</span>
				</div>
				<router-link to="/me/room" class="fact">
					<Icon name="bed" />
					<span><b>Мой номер</b>что внутри, соседи</span>
				</router-link>
				<router-link to="/me/hotel" class="fact">
					<Icon name="map-pin" />
					<span><b>Дом и посёлок</b>правила, что рядом</span>
				</router-link>
			</section>

			<!-- Главное действие -->
			<button class="report-btn" :disabled="!pl" @click="router.push('/me/issues')">
				<Icon name="wrench" size="1.2rem" /> Что-то сломалось — сообщить
			</button>

			<section v-if="openIssues.length">
				<h2 class="sec"><Icon name="wrench" /> Мои заявки</h2>
				<router-link v-for="i in openIssues" :key="i.id" to="/me/issues" class="issue-row">
					<span class="dot" :style="{ background: STATUS_COLOR[i.status] }" />
					<span class="grow">
						<span class="issue-title">{{ i.amenity_name || "Заявка" }}</span>
						<span class="muted issue-sub">{{ i.comment }}</span>
					</span>
					<span class="issue-status" :style="{ color: STATUS_COLOR[i.status], borderColor: STATUS_COLOR[i.status] }">{{ i.status }}</span>
				</router-link>
			</section>

			<section v-if="announcements.length">
				<h2 class="sec"><Icon name="megaphone" /> Объявления</h2>
				<article v-for="a in announcements" :key="a.id" class="ann" :class="{ pinned: a.pinned }">
					<div class="ann-head">
						<Icon v-if="a.pinned" name="pin" class="pin-ico" />
						<b class="contrast">{{ a.title }}</b>
						<span class="grow" />
						<span class="muted ann-date">{{ fmtLong(a.created_at) }}</span>
					</div>
					<p class="ann-body">{{ a.body }}</p>
				</article>
			</section>
		</template>
	</div>
</template>

<style scoped>
.hello {
	margin: 0;
	font-size: var(--font-size-2xl);
}
.skeleton-hero {
	height: 180px;
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
	50% {
		opacity: 0.55;
	}
}

/* Карточка размещения */
.stay-card {
	background: var(--brand-gradient-bg), var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	padding: var(--gap-lg);
}
.stay-top {
	display: flex;
	align-items: center;
	gap: var(--gap-lg);
	flex-wrap: wrap;
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
.stay-where {
	flex: 1;
	min-width: 150px;
}
.house {
	font-weight: 800;
	font-size: var(--font-size-lg);
	color: var(--color-contrast);
}
.place {
	font-size: var(--font-size-sm);
	margin-top: 2px;
}
.dates {
	margin-top: var(--gap-sm);
	font-size: var(--font-size-sm);
	font-weight: 600;
}
.countdown {
	display: grid;
	justify-items: center;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-lg);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	min-width: 104px;
}
.cd-top,
.cd-sub {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.cd-big {
	font-size: 2rem;
	font-weight: 800;
	line-height: 1.1;
	color: var(--color-contrast);
}
.countdown.live .cd-big {
	color: var(--color-green);
}
.countdown.soon .cd-big {
	color: var(--color-blue);
}
.progress {
	margin-top: var(--gap-lg);
}
.progress-bar {
	height: 8px;
	border-radius: var(--radius-max);
	background: var(--color-bg);
	overflow: hidden;
}
.progress-bar span {
	display: block;
	height: 100%;
	border-radius: var(--radius-max);
	background: var(--color-brand);
}
.progress-legend {
	margin-top: 6px;
	font-size: var(--font-size-xs);
}
.empty-stay {
	display: flex;
	gap: var(--gap-md);
	align-items: flex-start;
}
.empty-stay p {
	margin: 2px 0 0;
}

/* Дежурные сведения */
.facts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: var(--gap-sm);
}
.fact {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	color: var(--color-base);
	font-size: var(--font-size-sm);
}
.fact:hover {
	border-color: var(--color-brand);
}
.fact :deep(svg) {
	color: var(--color-brand);
	flex-shrink: 0;
}
.fact b {
	display: block;
	color: var(--color-contrast);
	font-size: var(--font-size-xs);
	font-weight: 700;
}

/* Главное действие */
.report-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--gap-sm);
	width: 100%;
	padding: var(--gap-md);
	font: inherit;
	font-weight: 700;
	cursor: pointer;
	color: #10131a;
	background: var(--color-brand);
	border: none;
	border-radius: var(--radius-md);
}
.report-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.sec {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	margin: 0 0 var(--gap-sm);
	font-size: var(--font-size-md);
	color: var(--color-contrast);
}
.issue-row {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	color: var(--color-base);
	margin-bottom: var(--gap-xs);
}
.issue-row .dot {
	width: 10px;
	height: 10px;
	border-radius: var(--radius-max);
	flex-shrink: 0;
}
.issue-title {
	display: block;
	font-weight: 700;
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
}
.issue-sub {
	display: block;
	font-size: var(--font-size-xs);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.issue-status {
	font-size: var(--font-size-xs);
	font-weight: 700;
	padding: 2px 8px;
	border: 1px solid;
	border-radius: var(--radius-max);
	white-space: nowrap;
}
.ann {
	padding: var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	margin-bottom: var(--gap-sm);
}
.ann.pinned {
	border-color: color-mix(in srgb, var(--color-brand), transparent 60%);
}
.ann-head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.pin-ico {
	color: var(--color-brand);
}
.ann-date {
	font-size: var(--font-size-xs);
	white-space: nowrap;
}
.ann-body {
	margin: var(--gap-xs) 0 0;
	white-space: pre-wrap;
	font-size: var(--font-size-sm);
}

@media (max-width: 560px) {
	.stay-top {
		gap: var(--gap-md);
	}
	.room-badge {
		min-width: 96px;
		padding: var(--gap-sm) var(--gap-md);
	}
	.room-no {
		font-size: 1.6rem;
	}
	.countdown {
		min-width: 84px;
	}
	.cd-big {
		font-size: 1.6rem;
	}
}
</style>
