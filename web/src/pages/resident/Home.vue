<script setup>
import { ref, onMounted, computed } from "vue"
import { loadFeed, feed, markAnnouncementsSeen } from "@/api/me"
import Icon from "@/components/Icon.vue"
import { CountUp } from "@/ui"
import IssueSteps from "@/components/IssueSteps.vue"

const loading = ref(true)
const seenAt = ref(null) // запоминаем до отметки «прочитано», чтобы подсветить новые
const ringReady = ref(false)

onMounted(async () => {
	try {
		await loadFeed(true)
		seenAt.value = feed.value?.seen_at || null
		markAnnouncementsSeen()
	} finally {
		loading.value = false
		requestAnimationFrame(() => requestAnimationFrame(() => (ringReady.value = true)))
	}
})

const pl = computed(() => feed.value?.placement || null)
const stay = computed(() => feed.value?.stay || null)
const hotel = computed(() => feed.value?.hotel || null)
const announcements = computed(() => feed.value?.announcements || [])
const openIssues = computed(() => (feed.value?.issues || []).filter((i) => i.status !== "Починено"))
const firstName = computed(() => (feed.value?.resident?.full_name || "").split(" ")[1] || "")
const isNew = (a) => !seenAt.value || a.created_at > seenAt.value

const hello = computed(() => {
	const h = new Date().getHours()
	return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"
})
const today = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })

// Состояние вахты: ждём заезда / живём / закончилась / размещения нет
const state = computed(() => {
	if (!pl.value || !stay.value) return "none"
	if (pl.value.stage === "checked_out" || stay.value.finished) return "done"
	return stay.value.started ? "live" : "soon"
})
const daysToArrival = computed(() => (stay.value ? Math.max(0, Math.round((new Date(stay.value.date_from || pl.value.date_from) - new Date()) / 86400000)) : 0))

// Кольцо: сколько вахты уже прошло
const R = 46
const C = 2 * Math.PI * R
const ring = computed(() => `${ringReady.value && stay.value ? (stay.value.percent / 100) * C : 0} ${C}`)

const plural = (n, one, few, many) => {
	const t = Math.abs(n) % 100
	if (t >= 11 && t <= 14) return many
	return [many, one, few, few, few][t % 10] || many
}
const short = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "")
const longDate = (d) => (d ? new Date(String(d).replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "")
const tel = (p) => "tel:" + String(p).replace(/[^\d+]/g, "")

</script>

<template>
	<div class="home">
		<header class="greet k-rise">
			<h1>{{ hello }}<template v-if="firstName">, {{ firstName }}</template></h1>
			<p>{{ today }}</p>
		</header>

		<div v-if="loading" class="skeleton" />

		<template v-else>
			<!-- Главная карточка: где живу и сколько осталось -->
			<section class="hero k-rise" :class="state" style="--i: 1">
				<template v-if="state === 'live'">
					<div class="ring">
						<svg viewBox="0 0 110 110" aria-hidden="true">
							<circle cx="55" cy="55" :r="R" class="ring__track" />
							<circle cx="55" cy="55" :r="R" class="ring__val" :stroke-dasharray="ring" transform="rotate(-90 55 55)" />
						</svg>
						<div class="ring__txt">
							<b><CountUp :value="Math.max(0, stay.days_left)" /></b>
							<span>{{ plural(stay.days_left, "день", "дня", "дней") }}<br />до выезда</span>
						</div>
					</div>
					<div class="hero__info">
						<div class="hero__room">№ {{ pl.room_number }} <span>· {{ pl.bed_label }}</span></div>
						<div class="hero__house">{{ pl.hotel_name }}</div>
						<div class="hero__meta">{{ [pl.hotel_settlement, pl.floor != null && pl.floor + " этаж"].filter(Boolean).join(" · ") }}</div>
						<div class="hero__dates"><Icon name="calendar" size="0.9rem" /> {{ short(pl.date_from) }} → {{ short(pl.date_to) }}<template v-if="hotel?.check_out">, выезд до {{ hotel.check_out }}</template></div>
						<div class="hero__day">День {{ stay.day_number }} из {{ stay.total_days }}</div>
					</div>
				</template>

				<template v-else-if="state === 'soon'">
					<div class="hero__icon"><Icon name="calendar" size="2rem" /></div>
					<div class="hero__info">
						<div class="hero__kicker">Скоро заезд</div>
						<div class="hero__big">через <CountUp :value="daysToArrival" /> {{ plural(daysToArrival, "день", "дня", "дней") }}</div>
						<div class="hero__meta">{{ short(pl.date_from) }} → {{ short(pl.date_to) }} · {{ pl.hotel_name }}, № {{ pl.room_number }}</div>
						<div v-if="hotel?.check_in" class="hero__day">Заселение с {{ hotel.check_in }}</div>
					</div>
				</template>

				<template v-else-if="state === 'done'">
					<div class="hero__icon"><Icon name="check" size="2rem" /></div>
					<div class="hero__info">
						<div class="hero__kicker">Вахта завершена</div>
						<div class="hero__big">Хорошей дороги домой!</div>
						<div class="hero__meta">{{ pl.hotel_name }}, № {{ pl.room_number }} · {{ short(pl.date_from) }} → {{ short(pl.date_to) }}</div>
					</div>
				</template>

				<template v-else>
					<div class="hero__icon"><Icon name="bed" size="2rem" /></div>
					<div class="hero__info">
						<div class="hero__kicker">Размещения пока нет</div>
						<div class="hero__big">Номер ещё не назначен</div>
						<div class="hero__meta">Как только комендант вас заселит, здесь появится номер и даты.</div>
					</div>
				</template>
			</section>

			<!-- Быстрые действия: всё главное в одно касание -->
			<section class="actions">
				<router-link v-if="pl" :to="{ path: '/me/issues', query: { new: 1 } }" class="act act--main k-rise" style="--i: 2">
					<span class="act__ic"><Icon name="wrench" size="1.3rem" /></span>
					<span><b>Что-то сломалось</b><small>сообщить коменданту</small></span>
				</router-link>
				<a v-if="hotel?.phone" :href="tel(hotel.phone)" class="act k-rise" style="--i: 3">
					<span class="act__ic"><Icon name="phone" size="1.2rem" /></span>
					<span><b>Позвонить коменданту</b><small class="nowrap">{{ hotel.phone }}</small></span>
				</a>
				<router-link v-if="pl" to="/me/plan" class="act k-rise" style="--i: 4">
					<span class="act__ic"><Icon name="layout" size="1.2rem" /></span>
					<span><b>План этажа</b><small>душ, кухня, выход</small></span>
				</router-link>
				<router-link v-if="pl" to="/me/place#mates" class="act k-rise" style="--i: 5">
					<span class="act__ic"><Icon name="users" size="1.2rem" /></span>
					<span><b>Соседи</b><small>кто живёт с вами</small></span>
				</router-link>
				<router-link v-if="pl" to="/me/place#house" class="act k-rise" style="--i: 6">
					<span class="act__ic"><Icon name="clock" size="1.2rem" /></span>
					<span><b>Распорядок и правила</b><small>от коменданта</small></span>
				</router-link>
			</section>

			<!-- Мои заявки со шкалой статуса -->
			<section v-if="openIssues.length" class="block k-rise" style="--i: 7">
				<div class="block__head">
					<h2><Icon name="wrench" /> Мои заявки</h2>
					<router-link to="/me/issues" class="more">все <Icon name="chevron-right" size="0.9rem" /></router-link>
				</div>
				<router-link v-for="i in openIssues" :key="i.id" to="/me/issues" class="issue">
					<div class="issue__top">
						<b>{{ i.amenity_name || "Заявка" }}</b>
						<span class="muted">{{ longDate(i.created_at) }}</span>
					</div>
					<p class="issue__text">{{ i.comment }}</p>
					<IssueSteps :status="i.status" />
				</router-link>
			</section>

			<!-- Объявления коменданта, новые подсвечены -->
			<section v-if="announcements.length" class="block k-rise" style="--i: 8">
				<div class="block__head">
					<h2><Icon name="megaphone" /> Объявления</h2>
				</div>
				<article v-for="a in announcements" :key="a.id" class="ann" :class="{ fresh: isNew(a), pinned: a.pinned }">
					<div class="ann__head">
						<Icon v-if="a.pinned" name="pin" class="ann__pin" />
						<b>{{ a.title }}</b>
						<span v-if="isNew(a)" class="ann__new">новое</span>
						<span class="grow" />
						<span class="muted ann__date">{{ longDate(a.created_at) }}</span>
					</div>
					<p class="ann__body">{{ a.body }}</p>
				</article>
			</section>
		</template>
	</div>
</template>

<style scoped>
.home {
	display: grid;
	gap: var(--gap-lg);
}
.greet h1 {
	font-size: 1.6rem;
	font-weight: var(--font-weight-extrabold);
	letter-spacing: -0.01em;
}
.greet p {
	margin: 2px 0 0;
	color: var(--color-secondary);
}
.greet p::first-letter {
	text-transform: uppercase;
}
.skeleton {
	height: 190px;
	border-radius: var(--radius-xl);
	background: linear-gradient(90deg, var(--color-raised-bg) 25%, var(--color-button-bg) 37%, var(--color-raised-bg) 63%);
	background-size: 400% 100%;
	animation: shimmer 1.4s ease infinite;
}
@keyframes shimmer {
	from {
		background-position: 100% 50%;
	}
	to {
		background-position: 0 50%;
	}
}

/* Главная карточка */
.hero {
	display: flex;
	align-items: center;
	gap: var(--gap-xl);
	padding: var(--gap-xl);
	border-radius: var(--radius-xl);
	border: 1px solid color-mix(in srgb, var(--color-brand) 30%, var(--color-divider));
	background: radial-gradient(420px 220px at 0% 0%, color-mix(in srgb, var(--color-brand) 22%, transparent), transparent 70%), var(--color-raised-bg);
	box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
}
.hero.soon {
	border-color: color-mix(in srgb, var(--color-blue) 40%, var(--color-divider));
	background: radial-gradient(420px 220px at 0% 0%, color-mix(in srgb, var(--color-blue) 20%, transparent), transparent 70%), var(--color-raised-bg);
}
.hero.done,
.hero.none {
	border-color: var(--color-divider);
	background: var(--color-raised-bg);
}
.ring {
	position: relative;
	width: 132px;
	height: 132px;
	flex-shrink: 0;
}
.ring svg {
	width: 100%;
	height: 100%;
}
.ring__track {
	fill: none;
	stroke: var(--color-bg);
	stroke-width: 9;
}
.ring__val {
	fill: none;
	stroke: var(--color-brand);
	stroke-width: 9;
	stroke-linecap: round;
	transition: stroke-dasharray 1s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.ring__txt {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	text-align: center;
	line-height: 1.05;
}
.ring__txt b {
	font-size: 2.2rem;
	font-weight: var(--font-weight-extrabold);
	color: var(--color-contrast);
}
/* только подпись, не счётчик внутри <b> */
.ring__txt > span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.hero__info {
	display: grid;
	gap: 3px;
	min-width: 0;
}
.hero__room {
	font-size: 1.9rem;
	font-weight: var(--font-weight-extrabold);
	color: var(--color-brand);
	line-height: 1.1;
}
.hero__room span {
	font-size: var(--font-size-nm);
	color: var(--color-secondary);
	font-weight: var(--font-weight-bold);
}
.hero__house {
	font-size: var(--font-size-lg);
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.hero__meta,
.hero__day {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
}
.hero__dates {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 4px;
	font-weight: var(--font-weight-bold);
	color: var(--color-base);
	font-size: var(--font-size-sm);
}
.hero__icon {
	display: grid;
	place-items: center;
	width: 4rem;
	height: 4rem;
	flex-shrink: 0;
	border-radius: 50%;
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.hero.soon .hero__icon {
	background: var(--color-blue-bg);
	color: var(--color-blue);
}
.hero.done .hero__icon {
	background: var(--color-green-bg);
	color: var(--color-green);
}
.hero__kicker {
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-secondary);
}
.hero__big {
	font-size: 1.5rem;
	font-weight: var(--font-weight-extrabold);
	color: var(--color-contrast);
	line-height: 1.15;
}

/* Быстрые действия */
.actions {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
	gap: var(--gap-sm);
}
.act {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-md);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	color: var(--color-base);
	transition: transform var(--speed-fast), border-color var(--speed-fast), box-shadow var(--speed-fast);
	-webkit-tap-highlight-color: transparent;
}
.act:hover {
	border-color: var(--color-brand);
	transform: translateY(-2px);
	box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16);
}
.act:active {
	transform: scale(0.98);
}
.act span {
	display: grid;
	min-width: 0;
}
.act b {
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
}
.act small {
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
}
.act__ic {
	display: grid !important;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	flex-shrink: 0;
	border-radius: var(--radius-md);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
/* Главное действие — крупнее и ярче, на всю ширину */
.act--main {
	grid-column: 1 / -1;
	background: var(--color-brand);
	border-color: var(--color-brand);
	padding: var(--gap-lg);
}
.act--main b,
.act--main small {
	color: var(--color-accent-contrast);
}
.act--main b {
	font-size: var(--font-size-nm);
}
.act--main .act__ic {
	background: color-mix(in srgb, var(--color-accent-contrast) 16%, transparent);
	color: var(--color-accent-contrast);
}

/* Блоки */
.block {
	display: grid;
	gap: var(--gap-sm);
}
.block__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.block__head h2 {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-lg);
}
.block__head h2 :deep(svg) {
	color: var(--color-brand);
}
.more {
	display: inline-flex;
	align-items: center;
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
}

/* Заявка со шкалой статуса */
.issue {
	display: grid;
	gap: 6px;
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	color: var(--color-base);
	transition: border-color var(--speed-fast);
}
.issue:hover {
	border-color: var(--color-brand);
}
.issue__top {
	display: flex;
	justify-content: space-between;
	gap: var(--gap-md);
	font-size: var(--font-size-sm);
}
.issue__top b {
	color: var(--color-contrast);
}
.issue__text {
	margin: 0;
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
/* Объявления */
.ann {
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
}
.ann.fresh {
	border-color: color-mix(in srgb, var(--color-brand) 55%, var(--color-divider));
	box-shadow: inset 3px 0 0 var(--color-brand);
}
.ann__head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.ann__head b {
	color: var(--color-contrast);
}
.ann__pin {
	color: var(--color-brand);
}
.ann__new {
	padding: 1px 8px;
	border-radius: 999px;
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	font-size: 10px;
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.ann__date {
	font-size: var(--font-size-xs);
	white-space: nowrap;
}
.ann__body {
	margin: 6px 0 0;
	white-space: pre-wrap;
	font-size: var(--font-size-sm);
}
.grow {
	flex: 1;
}
@media (max-width: 560px) {
	.hero {
		flex-direction: column;
		text-align: center;
		gap: var(--gap-md);
		padding: var(--gap-lg);
	}
	.hero__dates {
		justify-content: center;
	}
	.actions {
		grid-template-columns: 1fr 1fr;
	}
	.act {
		flex-direction: column;
		align-items: flex-start;
		gap: var(--gap-sm);
	}
	.act--main {
		flex-direction: row;
		align-items: center;
	}
}
</style>
