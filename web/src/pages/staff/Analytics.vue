<script setup>
import { ref, computed, onMounted } from "vue"
import { api, del } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import Stars from "@/components/Stars.vue"
import Icon from "@/components/Icon.vue"
import { PageHeader, Select, Card, Button, IconButton, MeterBar, Skeleton, EmptyState, SegmentedControl, DateRange } from "@/ui"
import { today, addDays, ymd, dateTime } from "@/utils/date"

const auth = useAuthStore()
const canEdit = auth.can("editor")

const hotels = ref([])
const hotelId = ref("")
const d = ref(null)
const loading = ref(false)
const reviews = ref(null)

// ── Период ────────────────────────────────────────────────────────────────────
const PRESETS = [
	{ value: "past30", label: "30 дней" },
	{ value: "month", label: "Этот месяц" },
	{ value: "prevMonth", label: "Прошлый месяц" },
	{ value: "year", label: "С начала года" },
	{ value: "next30", label: "Прогноз 30 дн." },
]
function range(p) {
	const t = today()
	const now = new Date()
	if (p === "past30") return [addDays(t, -29), t]
	if (p === "month") return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))]
	if (p === "prevMonth") return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))]
	if (p === "year") return [ymd(new Date(now.getFullYear(), 0, 1)), t]
	return [t, addDays(t, 29)]
}
const preset = ref("past30")
const [f0, t0] = range("past30")
const from = ref(f0)
const to = ref(t0)
function applyPreset(p) {
	preset.value = p
	;[from.value, to.value] = range(p)
	load()
}
function customRange() {
	preset.value = ""
	load()
}

async function load() {
	loading.value = true
	try {
		const q = new URLSearchParams({ from: from.value, to: to.value, ...(hotelId.value ? { hotel_id: hotelId.value } : {}) })
		d.value = await api("/analytics?" + q)
		const rid = hotelId.value || (hotels.value.length === 1 ? hotels.value[0].id : "")
		reviews.value = rid ? await api(`/hotels/${rid}/reviews`) : null
	} finally {
		loading.value = false
	}
}
onMounted(async () => {
	hotels.value = await api("/hotels")
	await load()
})
async function removeReview(r) {
	await del("/reviews/" + r.id)
	await load()
}

// ── Форматирование ───────────────────────────────────────────────────────────
const short = (v) => new Date(`${v}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
const long = (v) => new Date(`${v}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
const num = (n) => Number(n || 0).toLocaleString("ru-RU")
const plural = (n, one, few, many) => {
	const t = n % 100
	if (t >= 11 && t <= 14) return many
	return [many, one, few, few, few][n % 10] || many
}
const periodLabel = computed(() => (d.value ? `${short(d.value.from)} – ${short(d.value.to)} ${d.value.to.slice(0, 4)} · ${d.value.days} ${plural(d.value.days, "день", "дня", "дней")}` : ""))

// ── График загрузки ──────────────────────────────────────────────────────────
const W = 1000
const H = 220
const days = computed(() => d.value?.daily || [])
const x = (i) => (days.value.length > 1 ? (i / (days.value.length - 1)) * W : W / 2)
const y = (load) => H - (Math.min(load, 100) / 100) * H
const line = computed(() => days.value.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.load).toFixed(1)}`).join(" "))
const area = computed(() => (days.value.length ? `${line.value} L${W} ${H} L0 ${H} Z` : ""))
const avgY = computed(() => y(d.value?.totals.avgLoad || 0))
const todayIdx = computed(() => days.value.findIndex((p) => p.date === d.value?.today))
const ticks = computed(() => {
	const n = days.value.length
	if (!n) return []
	const step = Math.max(1, Math.round((n - 1) / 6))
	const idx = []
	for (let i = 0; i < n; i += step) idx.push(i)
	if (idx[idx.length - 1] !== n - 1 && n - 1 - idx[idx.length - 1] < step / 2) idx.pop()
	if (idx[idx.length - 1] !== n - 1) idx.push(n - 1)
	return idx.map((i) => ({ i, left: (x(i) / W) * 100, label: short(days.value[i].date) }))
})

const chart = ref(null)
const hi = ref(-1)
function onMove(e) {
	const r = chart.value.getBoundingClientRect()
	const n = days.value.length
	hi.value = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))))
}
const hp = computed(() => (hi.value >= 0 ? days.value[hi.value] : null))
const maxMove = computed(() => Math.max(1, ...days.value.map((p) => Math.max(p.arrivals, p.departures))))

const maxCompany = computed(() => Math.max(1, ...(d.value?.byCompany || []).map((c) => c.bed_nights)))
const maxDept = computed(() => Math.max(1, ...(d.value?.byDepartment || []).map((c) => c.bed_nights)))

// Выгрузка по дням — открывается в Excel (точка с запятой и BOM для кириллицы)
function exportCsv() {
	const rows = [["Дата", "Занято мест", "Загрузка, %", "Заезды", "Выезды"], ...days.value.map((p) => [p.date.split("-").reverse().join("."), p.occupied, p.load, p.arrivals, p.departures])]
	const blob = new Blob(["﻿" + rows.map((r) => r.join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" })
	const a = document.createElement("a")
	a.href = URL.createObjectURL(blob)
	a.download = `загрузка_${d.value.from}_${d.value.to}.csv`
	a.click()
	setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Аналитика" :subtitle="periodLabel || 'Загрузка, движение и состав проживающих'" icon="bar-chart">
			<template #actions>
				<Select v-model="hotelId" style="width: auto" @change="load">
					<option value="">Все гостиницы</option>
					<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
				</Select>
				<Button icon="download" :disabled="!d" @click="exportCsv">CSV</Button>
			</template>
		</PageHeader>

		<div class="period">
			<SegmentedControl :model-value="preset" :options="PRESETS" @update:model-value="applyPreset" />
			<DateRange v-model:from="from" v-model:to="to" :nights="false" :presets="[7, 14, 30, 90]" style="min-width: 18rem" @change="customRange" />
		</div>

		<Skeleton v-if="!d" variant="card" :count="2" />
		<template v-else>
			<div class="kpis" :class="{ dim: loading }">
				<div class="kpi accent">
					<span class="kpi__l">Средняя загрузка</span>
					<b class="kpi__v">{{ d.totals.avgLoad }}%</b>
					<span class="kpi__s">{{ d.totals.beds }} {{ plural(d.totals.beds, "место", "места", "мест") }} в {{ d.totals.rooms }} {{ plural(d.totals.rooms, "номере", "номерах", "номерах") }}</span>
				</div>
				<div class="kpi">
					<span class="kpi__l">Пик</span>
					<b class="kpi__v">{{ d.totals.peak?.load ?? 0 }}%</b>
					<span class="kpi__s">{{ d.totals.peak ? `${short(d.totals.peak.date)} · ${d.totals.peak.occupied} мест` : "—" }}</span>
				</div>
				<div class="kpi">
					<span class="kpi__l">Койко-ночей</span>
					<b class="kpi__v">{{ num(d.totals.bedNights) }}</b>
					<span class="kpi__s">из {{ num(d.totals.beds * d.days) }} возможных</span>
				</div>
				<div class="kpi">
					<span class="kpi__l">Заезды / выезды</span>
					<b class="kpi__v"><span class="in">{{ d.totals.arrivals }}</span> / <span class="out">{{ d.totals.departures }}</span></b>
					<span class="kpi__s">за период</span>
				</div>
				<div class="kpi">
					<span class="kpi__l">Проживало</span>
					<b class="kpi__v">{{ num(d.totals.people) }}</b>
					<span class="kpi__s">{{ plural(d.totals.people, "человек", "человека", "человек") }} · в среднем {{ d.totals.avgStay }} {{ plural(d.totals.avgStay, "ночь", "ночи", "ночей") }}</span>
				</div>
				<div class="kpi">
					<span class="kpi__l">Заявки</span>
					<b class="kpi__v">{{ d.totals.issues }}</b>
					<span class="kpi__s">починено {{ d.totals.issuesFixed }}</span>
				</div>
			</div>

			<Card pad="lg">
				<div class="spread ch-head">
					<div class="ch-title"><Icon name="trending-up" /> Загрузка по дням</div>
					<div class="ch-legend">
						<span><i class="lg brand" /> загрузка</span>
						<span><i class="lg dash" /> среднее {{ d.totals.avgLoad }}%</span>
						<span><i class="lg in" /> заезды</span>
						<span><i class="lg out" /> выезды</span>
					</div>
				</div>

				<div ref="chart" class="ch" @mousemove="onMove" @mouseleave="hi = -1">
					<div class="ch__plot">
						<div v-for="g in [100, 75, 50, 25]" :key="g" class="ch__grid" :style="{ top: 100 - g + '%' }"><span>{{ g }}%</span></div>
						<svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="ch__svg">
							<defs>
								<linearGradient id="an-fill" x1="0" x2="0" y1="0" y2="1">
									<stop offset="0" stop-color="var(--color-brand)" stop-opacity="0.45" />
									<stop offset="1" stop-color="var(--color-brand)" stop-opacity="0.02" />
								</linearGradient>
							</defs>
							<path :d="area" fill="url(#an-fill)" />
							<path :d="line" fill="none" stroke="var(--color-brand)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
							<line x1="0" :x2="W" :y1="avgY" :y2="avgY" stroke="var(--color-secondary)" stroke-dasharray="6 6" vector-effect="non-scaling-stroke" />
						</svg>
						<div v-if="todayIdx >= 0" class="ch__today" :style="{ left: (x(todayIdx) / W) * 100 + '%' }"><span>сегодня</span></div>
						<template v-if="hp">
							<div class="ch__cursor" :style="{ left: (x(hi) / W) * 100 + '%' }" />
							<div class="ch__dot" :style="{ left: (x(hi) / W) * 100 + '%', top: (y(hp.load) / H) * 100 + '%' }" />
							<div class="ch__tip" :class="{ flip: x(hi) / W > 0.7 }" :style="{ left: (x(hi) / W) * 100 + '%' }">
								<b>{{ long(hp.date) }}</b>
								<span>загрузка <b>{{ hp.load }}%</b> · занято {{ hp.occupied }} из {{ d.totals.beds }}</span>
								<span><i class="lg in" /> заездов {{ hp.arrivals }} · <i class="lg out" /> выездов {{ hp.departures }}</span>
							</div>
						</template>
					</div>
					<div class="ch__moves">
						<div v-for="(p, i) in days" :key="p.date" class="ch__mv" :class="{ on: i === hi }">
							<i class="in" :style="{ height: (p.arrivals / maxMove) * 100 + '%' }" />
							<i class="out" :style="{ height: (p.departures / maxMove) * 100 + '%' }" />
						</div>
					</div>
					<div class="ch__x">
						<span v-for="t in ticks" :key="t.i" :style="{ left: t.left + '%' }">{{ t.label }}</span>
					</div>
				</div>
			</Card>

			<div class="cols">
				<Card pad="lg" title="По гостиницам" subtitle="Средняя загрузка за период">
					<EmptyState v-if="!d.byHotel.length" icon="building" text="Нет гостиниц" />
					<table v-else class="tbl">
						<thead><tr><th>Гостиница</th><th>Мест</th><th style="width: 40%">Загрузка</th><th class="r">Койко-ночей</th></tr></thead>
						<tbody>
							<tr v-for="h in d.byHotel" :key="h.id">
								<td class="contrast b">{{ h.name }}</td>
								<td>{{ h.beds }}</td>
								<td><div class="meter"><MeterBar :value="h.load" /><span>{{ h.load }}%</span></div></td>
								<td class="r">{{ num(h.bed_nights) }}</td>
							</tr>
						</tbody>
					</table>
				</Card>

				<Card pad="lg" title="Организации" subtitle="Сколько человек и койко-ночей">
					<EmptyState v-if="!d.byCompany.length" icon="users" text="За период никто не проживал" />
					<div v-for="c in d.byCompany" :key="c.name" class="hb">
						<div class="hb__top"><span class="hb__name">{{ c.name }}</span><span class="muted">{{ c.people }} чел. · <b class="contrast">{{ num(c.bed_nights) }}</b></span></div>
						<div class="hb__track"><div class="hb__fill" :style="{ width: (c.bed_nights / maxCompany) * 100 + '%' }" /></div>
					</div>
				</Card>
			</div>

			<div class="cols">
				<Card pad="lg" title="Подразделения" subtitle="Кто больше всех занимает фонд">
					<EmptyState v-if="!d.byDepartment.length" icon="users" text="Нет данных" />
					<div v-for="c in d.byDepartment" :key="c.name" class="hb">
						<div class="hb__top"><span class="hb__name">{{ c.name }}</span><span class="muted">{{ c.people }} чел. · <b class="contrast">{{ num(c.bed_nights) }}</b></span></div>
						<div class="hb__track"><div class="hb__fill alt" :style="{ width: (c.bed_nights / maxDept) * 100 + '%' }" /></div>
					</div>
				</Card>

				<Card v-if="reviews" pad="lg" title="Отзывы проживающих">
					<template #actions>
						<div v-if="reviews.average" class="row" style="gap: 6px"><Stars :model-value="reviews.average" readonly size="1rem" /> <b class="contrast">{{ reviews.average }}</b> <span class="muted">({{ reviews.count }})</span></div>
					</template>
					<EmptyState v-if="!reviews.reviews.length" icon="message-square" text="Отзывов пока нет" />
					<div v-for="rv in reviews.reviews.slice(0, 6)" :key="rv.id" class="rv">
						<div class="spread">
							<div class="row" style="gap: 6px"><Stars :model-value="rv.rating" readonly size="0.9rem" /> <b class="contrast">{{ rv.resident_name || "Аноним" }}</b></div>
							<div class="row" style="gap: 4px">
								<span class="muted rv__date">{{ dateTime(rv.created_at, { dateStyle: "medium" }) }}</span>
								<IconButton v-if="canEdit" icon="x" label="Удалить отзыв" size="sm" variant="danger" @click="removeReview(rv)" />
							</div>
						</div>
						<p v-if="rv.text" class="rv__text">{{ rv.text }}</p>
					</div>
				</Card>
				<Card v-else pad="lg">
					<EmptyState icon="message-square" title="Отзывы" text="Выберите гостиницу, чтобы увидеть отзывы проживающих" />
				</Card>
			</div>
		</template>
	</div>
</template>

<style scoped>
.period {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
}
.period__dates {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
}
.kpis {
	display: grid;
	grid-template-columns: repeat(6, minmax(0, 1fr));
	gap: var(--gap-md);
	transition: opacity var(--speed);
}
.dim {
	opacity: 0.55;
}
.kpi {
	display: grid;
	gap: 2px;
	padding: var(--gap-md) var(--gap-lg);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	min-width: 0;
}
.kpi.accent {
	background: var(--brand-gradient-bg), var(--color-raised-bg);
	border-color: var(--color-brand);
}
.kpi__l {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	text-transform: uppercase;
	letter-spacing: 0.04em;
	font-weight: var(--font-weight-bold);
}
.kpi__v {
	font-size: 1.6rem;
	font-weight: var(--font-weight-extrabold);
	color: var(--color-contrast);
	line-height: 1.15;
	font-variant-numeric: tabular-nums;
}
.kpi.accent .kpi__v {
	color: var(--color-brand);
}
.kpi__v .in {
	color: var(--color-blue);
}
.kpi__v .out {
	color: var(--color-orange);
}
.kpi__s {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* График */
.ch-head {
	flex-wrap: wrap;
	gap: var(--gap-md);
	margin-bottom: var(--gap-lg);
}
.ch-title {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.ch-title :deep(svg) {
	color: var(--color-brand);
}
.ch-legend {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-md);
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.ch-legend span,
.ch__tip span {
	display: inline-flex;
	align-items: center;
	gap: 5px;
}
.lg {
	display: inline-block;
	width: 10px;
	height: 10px;
	border-radius: 3px;
}
.lg.brand {
	background: var(--color-brand);
}
.lg.dash {
	height: 0;
	border-top: 2px dashed var(--color-secondary);
	border-radius: 0;
}
.lg.in,
.ch__mv .in {
	background: var(--color-blue);
}
.lg.out,
.ch__mv .out {
	background: var(--color-orange);
}
.ch {
	position: relative;
	padding-left: 2.6rem;
	cursor: crosshair;
	user-select: none;
}
.ch__plot {
	position: relative;
	height: 220px;
}
.ch__svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
}
.ch__grid {
	position: absolute;
	left: 0;
	right: 0;
	border-top: 1px solid var(--color-divider);
}
.ch__grid span {
	position: absolute;
	left: -2.6rem;
	top: -0.55rem;
	width: 2.2rem;
	text-align: right;
	font-size: 0.68rem;
	color: var(--color-secondary);
}
.ch__today {
	position: absolute;
	top: -6px;
	bottom: 0;
	border-left: 1px dashed var(--color-brand);
}
.ch__today span {
	position: absolute;
	top: -12px;
	left: 4px;
	font-size: 0.65rem;
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.ch__cursor {
	position: absolute;
	top: 0;
	bottom: 0;
	border-left: 1px solid var(--color-contrast);
	opacity: 0.35;
	pointer-events: none;
}
.ch__dot {
	position: absolute;
	width: 10px;
	height: 10px;
	margin: -5px 0 0 -5px;
	border-radius: 50%;
	background: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-raised-bg);
	pointer-events: none;
}
.ch__tip {
	position: absolute;
	top: 8px;
	margin-left: 12px;
	z-index: 3;
	display: grid;
	gap: 3px;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	box-shadow: var(--shadow-floating);
	font-size: var(--font-size-xs);
	white-space: nowrap;
	pointer-events: none;
}
.ch__tip.flip {
	transform: translateX(calc(-100% - 24px));
}
.ch__tip b {
	color: var(--color-contrast);
}
.ch__moves {
	display: flex;
	align-items: flex-end;
	height: 36px;
	margin-top: var(--gap-sm);
	gap: 1px;
}
.ch__mv {
	flex: 1;
	min-width: 0;
	height: 100%;
	display: flex;
	align-items: flex-end;
	justify-content: center;
	gap: 1px;
	border-radius: 2px;
}
.ch__mv.on {
	background: var(--color-bg);
}
.ch__mv i {
	flex: 1;
	max-width: 6px;
	border-radius: 2px 2px 0 0;
	opacity: 0.85;
}
.ch__x {
	position: relative;
	height: 1.2rem;
	margin-top: 4px;
}
.ch__x span {
	position: absolute;
	transform: translateX(-50%);
	font-size: 0.7rem;
	color: var(--color-secondary);
	white-space: nowrap;
}
.ch__x span:first-child {
	transform: none;
}
.ch__x span:last-child {
	transform: translateX(-100%);
}

.cols {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: var(--gap-lg);
	align-items: start;
}
.tbl {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--font-size-sm);
}
.tbl th {
	text-align: left;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	text-transform: uppercase;
	letter-spacing: 0.03em;
	white-space: nowrap;
	padding: 0 var(--gap-sm) var(--gap-sm) 0;
	border-bottom: 1px solid var(--color-divider);
}
.tbl td {
	padding: var(--gap-sm) var(--gap-sm) var(--gap-sm) 0;
	border-bottom: 1px solid var(--color-divider);
}
.tbl tr:last-child td {
	border-bottom: none;
}
.tbl .r {
	text-align: right;
	padding-right: 0;
}
.b {
	font-weight: var(--font-weight-bold);
}
.meter {
	display: grid;
	grid-template-columns: 1fr 2.6rem;
	align-items: center;
	gap: var(--gap-sm);
}
.meter span {
	text-align: right;
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.hb {
	margin-bottom: var(--gap-md);
}
.hb:last-child {
	margin-bottom: 0;
}
.hb__top {
	display: flex;
	justify-content: space-between;
	gap: var(--gap-md);
	font-size: var(--font-size-sm);
	margin-bottom: 4px;
}
.hb__name {
	color: var(--color-contrast);
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.hb__top .muted {
	white-space: nowrap;
}
.hb__track {
	height: 8px;
	border-radius: var(--radius-max);
	background: var(--color-bg);
	overflow: hidden;
}
.hb__fill {
	height: 100%;
	border-radius: var(--radius-max);
	background: var(--color-brand);
	transition: width 400ms ease;
}
.hb__fill.alt {
	background: var(--color-blue);
}
.rv {
	padding: var(--gap-sm) 0;
	border-bottom: 1px solid var(--color-divider);
}
.rv:last-child {
	border-bottom: none;
}
.rv__date {
	font-size: var(--font-size-xs);
}
.rv__text {
	margin: 4px 0 0;
	font-size: var(--font-size-sm);
	color: var(--color-base);
}
@media (max-width: 1500px) {
	.kpis {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
}
@media (max-width: 860px) {
	.cols {
		grid-template-columns: 1fr;
	}
	.kpis {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
