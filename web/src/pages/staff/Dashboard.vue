<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue"
import { api } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import Icon from "@/components/Icon.vue"
import { Card, Chip, Skeleton, EmptyState, Button, IconButton, MeterBar } from "@/ui"

const auth = useAuthStore()
const d = ref(null)
const loading = ref(false)
const hover = ref(null)

async function load() {
	loading.value = true
	try {
		d.value = await api("/dashboard")
	} finally {
		loading.value = false
	}
}
// Главная висит открытой весь день — обновляем сами, пока вкладка на виду
let timer
onMounted(() => {
	load()
	timer = setInterval(() => document.visibilityState === "visible" && load(), 60000)
})
onUnmounted(() => clearInterval(timer))

const hello = computed(() => {
	const h = new Date().getHours()
	const part = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"
	const name = (auth.user?.full_name || "").split(" ")[1] || auth.user?.full_name || ""
	return name && name !== "Администратор" ? `${part}, ${name}` : part
})
const dateLine = computed(() => new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }))

const tension = computed(() => {
	const load = d.value?.totals.load || 0
	if (load >= 95) return { label: "Мест почти нет", color: "var(--color-red)" }
	if (load >= 80) return { label: "Плотная загрузка", color: "var(--color-orange)" }
	return { label: "Запас есть", color: "var(--color-green)" }
})

// Кольцо загрузки
const R = 52
const C = 2 * Math.PI * R
const ring = computed(() => `${((d.value?.totals.load || 0) / 100) * C} ${C}`)

// Прогноз: высота — занятость относительно всех мест, подпись — сколько свободно
const beds = computed(() => Math.max(1, d.value?.totals.beds || 1))
const minFree = computed(() => (d.value?.trend || []).reduce((m, x) => (!m || x.free < m.free ? x : m), null))
const tone = (load) => (load >= 95 ? "red" : load >= 80 ? "orange" : "ok")
const wd = (v) => new Date(`${v}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "short" })
const dayNum = (v) => +v.slice(8, 10)
const isWeekend = (v) => [0, 6].includes(new Date(`${v}T00:00:00`).getDay())
const longDate = (v) => new Date(`${v}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })

const attention = computed(() => {
	const a = d.value?.attention
	if (!a) return []
	return [
		{ key: "overdue", color: "var(--color-red)", n: a.overdue.length, title: "Не выселены вовремя", hint: "срок вышел, а стадия всё ещё «Проживает»", people: a.overdue, to: "/app/rack" },
		{ key: "noshow", color: "var(--color-orange)", n: a.noshow.length, title: "Не заехали", hint: "дата заезда прошла, заселение не отмечено", people: a.noshow, to: "/app/rack" },
		{ key: "issues", color: "var(--color-blue)", n: a.issuesNew, title: "Новые заявки на ремонт", hint: `всего открыто: ${a.issuesOpen}`, to: "/app/issues" },
		{ key: "repair", color: "var(--color-orange)", n: a.repair, title: "Номера на ремонте", hint: "сегодня недоступны для заселения", to: "/app/plan" },
	].filter((x) => x.n > 0)
})
const who = (a) =>
	a.people?.length
		? a.people.slice(0, 2).map((p) => p.resident_name || "без карточки").join(", ") + (a.people.length > 2 ? ` и ещё ${a.people.length - 2}` : "")
		: a.hint

const rackLink = (row) => ({ path: "/app/rack", query: { hotel_id: row.hotel_id ?? row.id, from: d.value.date } })
const place = (r) => `${r.hotel_name} · № ${r.room_number} · ${r.bed_label}`
const plural = (n, one, few, many) => {
	const t = n % 100
	if (t >= 11 && t <= 14) return many
	return [many, one, few, few, few][n % 10] || many
}
</script>

<template>
	<div class="dash">
		<header class="hero">
			<div>
				<h1 class="hero__hello">{{ hello }}</h1>
				<p class="hero__date">
					{{ dateLine }}<template v-if="d"> · {{ d.totals.hotels }} {{ plural(d.totals.hotels, "гостиница", "гостиницы", "гостиниц") }}, {{ d.totals.rooms }} {{ plural(d.totals.rooms, "номер", "номера", "номеров") }}</template>
				</p>
			</div>
			<div class="hero__actions">
				<IconButton icon="rotate-cw" label="Обновить" :class="{ spin: loading }" @click="load" />
				<Button icon="search" to="/app/rack?tab=free">Свободные места</Button>
				<Button variant="primary" icon="calendar" to="/app/rack">Календарь броней</Button>
			</div>
		</header>

		<template v-if="!d">
			<div class="row3"><Skeleton v-for="n in 3" :key="n" variant="card" /></div>
			<Skeleton variant="card" />
		</template>

		<template v-else>
			<div class="row3">
				<!-- Загрузка -->
				<Card pad="lg" class="occ">
					<svg viewBox="0 0 128 128" class="occ__ring" role="img" :aria-label="`Загрузка ${d.totals.load}%`">
						<circle cx="64" cy="64" :r="R" class="occ__track" />
						<circle cx="64" cy="64" :r="R" class="occ__val" :style="{ stroke: tension.color }" :stroke-dasharray="ring" transform="rotate(-90 64 64)" />
						<text x="64" y="64" text-anchor="middle" class="occ__pct">{{ d.totals.load }}%</text>
						<text x="64" y="82" text-anchor="middle" class="occ__cap">загрузка</text>
					</svg>
					<div class="occ__text">
						<div class="occ__big"><b>{{ d.totals.free }}</b> {{ plural(d.totals.free, "место свободно", "места свободно", "мест свободно") }}</div>
						<div class="muted">занято {{ d.totals.occupied }} из {{ d.totals.beds }}</div>
						<Chip :color="tension.color" dot style="margin-top: var(--gap-sm)">{{ tension.label }}</Chip>
					</div>
				</Card>

				<!-- Сегодня -->
				<Card pad="lg">
					<div class="card-h"><Icon name="calendar" /> Сегодня</div>
					<div class="today__nums">
						<div class="today__num in"><b>{{ d.totals.checkins }}</b><span>{{ plural(d.totals.checkins, "заезд", "заезда", "заездов") }}</span></div>
						<div class="today__num out"><b>{{ d.totals.checkouts }}</b><span>{{ plural(d.totals.checkouts, "выезд", "выезда", "выездов") }}</span></div>
					</div>
					<div v-if="d.arrivals.length || d.departures.length" class="moves">
						<router-link v-for="r in d.arrivals.slice(0, 3)" :key="'a' + r.id" :to="rackLink(r)" class="move">
							<span class="move__ic in"><Icon name="arrow-right" size="0.85rem" /></span>
							<span class="grow"><b>{{ r.resident_name || "Без карточки" }}</b><span class="muted">{{ place(r) }}</span></span>
						</router-link>
						<router-link v-for="r in d.departures.slice(0, 3)" :key="'d' + r.id" :to="rackLink(r)" class="move">
							<span class="move__ic out"><Icon name="log-out" size="0.85rem" /></span>
							<span class="grow"><b>{{ r.resident_name || "Без карточки" }}</b><span class="muted">{{ place(r) }}</span></span>
						</router-link>
						<router-link v-if="d.arrivals.length > 3 || d.departures.length > 3" to="/app/history" class="more">все движения за день →</router-link>
					</div>
					<p v-else class="muted calm">Сегодня без заездов и выездов</p>
				</Card>

				<!-- Требует внимания -->
				<Card pad="lg">
					<div class="card-h"><Icon name="bell" /> Требует внимания</div>
					<div v-if="!attention.length" class="allgood">
						<span class="allgood__ic"><Icon name="check" size="1.4rem" /></span>
						<b>Всё в порядке</b>
						<span class="muted">Просроченных выездов, незаездов и новых заявок нет</span>
					</div>
					<router-link v-for="a in attention" :key="a.key" :to="a.to" class="attn__item">
						<span class="attn__n" :style="{ color: a.color, background: `color-mix(in srgb, ${a.color}, transparent 85%)` }">{{ a.n }}</span>
						<span class="grow">
							<b>{{ a.title }}</b>
							<span class="muted">{{ who(a) }}</span>
						</span>
						<Icon name="chevron-right" class="muted" />
					</router-link>
				</Card>
			</div>

			<!-- Прогноз -->
			<Card pad="lg">
				<div class="spread fc-head">
					<div>
						<div class="card-h" style="margin: 0"><Icon name="trending-up" /> Свободные места на 2 недели</div>
						<div v-if="minFree" class="muted fc-sub">
							Меньше всего — <b class="contrast">{{ minFree.free }}</b> {{ plural(minFree.free, "место", "места", "мест") }}, {{ longDate(minFree.date) }}
						</div>
					</div>
					<div class="legend">
						<span><i class="lg ok" /> до 80%</span>
						<span><i class="lg orange" /> 80–95%</span>
						<span><i class="lg red" /> 95%+</span>
					</div>
				</div>
				<div class="fc" @mouseleave="hover = null">
					<div
						v-for="x in d.trend"
						:key="x.date"
						class="fc__col"
						:class="{ on: hover === x.date, today: x.date === d.date, we: isWeekend(x.date) }"
						@mouseenter="hover = x.date"
					>
						<span class="fc__free">{{ x.free }}</span>
						<div class="fc__track">
							<div class="fc__bar" :class="tone(x.load)" :style="{ height: Math.max(2, (x.occupied / beds) * 100) + '%' }" />
						</div>
						<span class="fc__wd">{{ x.date === d.date ? "сег" : wd(x.date) }}</span>
						<span class="fc__day">{{ dayNum(x.date) }}</span>
						<div v-if="hover === x.date" class="fc__tip">
							<b>{{ longDate(x.date) }}</b>
							<span>занято {{ x.occupied }} из {{ d.totals.beds }} · {{ x.load }}%</span>
							<span>свободно {{ x.free }}</span>
						</div>
					</div>
				</div>
				<div class="fc-foot muted">Число над столбцом — свободные места в этот день, высота — занятость</div>
			</Card>

			<!-- Гостиницы -->
			<Card pad="lg">
				<div class="card-h"><Icon name="building" /> Гостиницы <span class="muted card-h__sub">сначала самые загруженные · клик — календарь</span></div>
				<EmptyState v-if="!d.hotels.length" icon="building" title="Гостиниц пока нет" text="Добавьте первую в разделе «Гостиницы и номера»">
					<Button to="/app/hotels" icon="plus">Добавить гостиницу</Button>
				</EmptyState>
				<div class="hotels">
					<router-link v-for="h in [...d.hotels].sort((a, b) => b.load - a.load)" :key="h.id" :to="rackLink(h)" class="hotel">
						<span class="hotel__name">{{ h.name }}</span>
						<MeterBar :value="h.load" class="hotel__bar" />
						<span class="hotel__pct" :class="tone(h.load)">{{ h.load }}%</span>
						<span class="hotel__free"><b>{{ h.free }}</b> своб. из {{ h.beds }}</span>
						<Icon name="chevron-right" class="muted hotel__go" />
					</router-link>
				</div>
			</Card>
		</template>
	</div>
</template>

<style scoped>
.dash {
	display: grid;
	gap: var(--gap-lg);
}
.hero {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: var(--gap-lg);
	flex-wrap: wrap;
}
.hero__hello {
	font-size: 1.75rem;
	font-weight: var(--font-weight-extrabold);
	letter-spacing: -0.01em;
}
.hero__date {
	margin: 2px 0 0;
	color: var(--color-secondary);
}
.hero__date::first-letter {
	text-transform: uppercase;
}
.hero__actions {
	display: flex;
	gap: var(--gap-sm);
	align-items: center;
	flex-wrap: wrap;
}
.spin :deep(svg) {
	animation: spin 0.8s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.row3 {
	display: grid;
	grid-template-columns: 1.1fr 1fr 1fr;
	gap: var(--gap-lg);
	align-items: stretch;
}
.card-h {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
	margin-bottom: var(--gap-md);
}
.card-h :deep(svg) {
	color: var(--color-brand);
}
.card-h__sub {
	font-weight: 400;
	font-size: var(--font-size-sm);
}

/* Загрузка */
.occ {
	display: flex;
	align-items: center;
	gap: var(--gap-lg);
	background: var(--brand-gradient-bg), var(--color-raised-bg);
}
.occ__ring {
	width: 132px;
	height: 132px;
	flex-shrink: 0;
}
.occ__track {
	fill: none;
	stroke: var(--color-bg);
	stroke-width: 12;
}
.occ__val {
	fill: none;
	stroke-width: 12;
	stroke-linecap: round;
	transition: stroke-dasharray 600ms ease;
}
.occ__pct {
	fill: var(--color-contrast);
	font-size: 26px;
	font-weight: 800;
}
.occ__cap {
	fill: var(--color-secondary);
	font-size: 11px;
}
.occ__big {
	color: var(--color-contrast);
	font-size: var(--font-size-lg);
	line-height: 1.2;
}
.occ__big b {
	font-size: 2.2rem;
	font-weight: var(--font-weight-extrabold);
	display: block;
	line-height: 1;
}

/* Сегодня */
.today__nums {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-sm);
}
.today__num {
	display: grid;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-bg);
}
.today__num b {
	font-size: 1.6rem;
	line-height: 1.1;
}
.today__num span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.today__num.in b {
	color: var(--color-blue);
}
.today__num.out b {
	color: var(--color-orange);
}
.moves {
	display: grid;
	gap: 2px;
	margin-top: var(--gap-md);
}
.move,
.attn__item {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	padding: 6px var(--gap-sm);
	margin: 0 calc(-1 * var(--gap-sm));
	border-radius: var(--radius-sm);
	color: var(--color-base);
	font-size: var(--font-size-sm);
	min-width: 0;
}
.move:hover,
.attn__item:hover {
	background: var(--color-bg);
}
.move .grow,
.attn__item .grow {
	display: grid;
	min-width: 0;
}
.move b,
.attn__item b {
	color: var(--color-contrast);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.move .muted,
.attn__item .muted {
	font-size: var(--font-size-xs);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.move__ic {
	display: grid;
	place-items: center;
	width: 1.6rem;
	height: 1.6rem;
	border-radius: 50%;
	flex-shrink: 0;
}
.move__ic.in {
	background: var(--color-blue-bg);
	color: var(--color-blue);
}
.move__ic.out {
	background: var(--color-orange-bg);
	color: var(--color-orange);
}
.more {
	font-size: var(--font-size-xs);
	margin-top: 4px;
}
.calm {
	margin: var(--gap-md) 0 0;
	font-size: var(--font-size-sm);
}

/* Внимание */
.attn__n {
	display: grid;
	place-items: center;
	min-width: 2rem;
	height: 2rem;
	padding: 0 6px;
	border-radius: var(--radius-md);
	font-weight: var(--font-weight-extrabold);
	flex-shrink: 0;
}
.allgood {
	display: grid;
	justify-items: center;
	text-align: center;
	gap: 4px;
	padding: var(--gap-sm) 0;
	font-size: var(--font-size-sm);
}
.allgood b {
	color: var(--color-contrast);
}
.allgood__ic {
	display: grid;
	place-items: center;
	width: 2.8rem;
	height: 2.8rem;
	border-radius: 50%;
	background: var(--color-green-bg);
	color: var(--color-green);
	margin-bottom: 4px;
}

/* Прогноз */
.fc-head {
	align-items: flex-start;
	flex-wrap: wrap;
	gap: var(--gap-md);
}
.fc-sub {
	font-size: var(--font-size-sm);
	margin-top: 2px;
}
.legend {
	display: flex;
	gap: var(--gap-md);
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.legend span {
	display: inline-flex;
	align-items: center;
	gap: 5px;
}
.lg {
	width: 10px;
	height: 10px;
	border-radius: 3px;
}
.lg.ok,
.fc__bar.ok {
	background: var(--color-brand);
}
.lg.orange,
.fc__bar.orange {
	background: var(--color-orange);
}
.lg.red,
.fc__bar.red {
	background: var(--color-red);
}
.fc {
	display: grid;
	grid-template-columns: repeat(14, minmax(0, 1fr));
	gap: 6px;
	margin-top: var(--gap-lg);
}
.fc__col {
	position: relative;
	display: grid;
	justify-items: center;
	gap: 4px;
	padding: 6px 0;
	border-radius: var(--radius-md);
	cursor: default;
}
.fc__col.on {
	background: var(--color-bg);
}
.fc__col.today {
	box-shadow: inset 0 0 0 1px var(--color-brand);
}
.fc__free {
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
	font-variant-numeric: tabular-nums;
}
.fc__track {
	width: 60%;
	max-width: 28px;
	height: 120px;
	display: flex;
	align-items: flex-end;
	background: var(--color-bg);
	border-radius: 6px;
	overflow: hidden;
}
.fc__col.on .fc__track {
	background: var(--color-button-bg);
}
.fc__bar {
	width: 100%;
	border-radius: 6px 6px 0 0;
	opacity: 0.85;
	transition: height 400ms ease;
}
.fc__col.on .fc__bar {
	opacity: 1;
}
.fc__wd {
	font-size: 0.68rem;
	color: var(--color-secondary);
	text-transform: uppercase;
}
.fc__col.we .fc__wd {
	color: var(--color-red);
}
.fc__day {
	font-size: var(--font-size-xs);
	color: var(--color-base);
	font-weight: var(--font-weight-bold);
	margin-top: -4px;
}
.fc__col.today .fc__wd,
.fc__col.today .fc__day {
	color: var(--color-brand);
}
.fc__tip {
	position: absolute;
	bottom: calc(100% + 4px);
	left: 50%;
	transform: translateX(-50%);
	z-index: 5;
	display: grid;
	gap: 2px;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	box-shadow: var(--shadow-floating);
	font-size: var(--font-size-xs);
	white-space: nowrap;
	pointer-events: none;
}
.fc__col:nth-child(-n + 2) .fc__tip {
	left: 0;
	transform: none;
}
.fc__col:nth-last-child(-n + 2) .fc__tip {
	left: auto;
	right: 0;
	transform: none;
}
.fc__tip b {
	color: var(--color-contrast);
}
.fc-foot {
	margin-top: var(--gap-sm);
	font-size: var(--font-size-xs);
}

/* Гостиницы */
.hotels {
	display: grid;
	gap: 2px;
}
.hotel {
	display: grid;
	grid-template-columns: minmax(140px, 1.3fr) minmax(80px, 2fr) 3.2rem auto auto;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-sm) var(--gap-md);
	margin: 0 calc(-1 * var(--gap-md));
	border-radius: var(--radius-md);
	color: var(--color-base);
	font-size: var(--font-size-sm);
}
.hotel:hover {
	background: var(--color-bg);
}
.hotel__name {
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.hotel__pct {
	text-align: right;
	font-weight: var(--font-weight-bold);
	font-variant-numeric: tabular-nums;
}
.hotel__pct.orange {
	color: var(--color-orange);
}
.hotel__pct.red {
	color: var(--color-red);
}
.hotel__free {
	color: var(--color-secondary);
	white-space: nowrap;
}
.hotel__free b {
	color: var(--color-contrast);
}

@media (max-width: 1100px) {
	.row3 {
		grid-template-columns: 1fr 1fr;
	}
	.occ {
		grid-column: 1 / -1;
	}
}
@media (max-width: 700px) {
	.row3 {
		grid-template-columns: 1fr;
	}
	.fc {
		gap: 2px;
	}
	.fc__free {
		font-size: var(--font-size-xs);
	}
	.hotel {
		grid-template-columns: 1fr 3rem auto;
	}
	.hotel__bar,
	.hotel__go {
		display: none;
	}
	.legend {
		display: none;
	}
}
</style>
