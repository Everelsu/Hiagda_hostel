<script setup>
import { ref, onMounted, computed } from "vue"
import { api, del } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import Stars from "@/components/Stars.vue"
import Icon from "@/components/Icon.vue"

const auth = useAuthStore()
const canEdit = auth.can("editor")
const hotels = ref([])
const hotelId = ref("")
const d = ref(null)
const reviews = ref(null)

const reviewHotelId = computed(() => hotelId.value || (hotels.value.length === 1 ? hotels.value[0].id : ""))

async function load() {
	d.value = await api("/analytics" + (hotelId.value ? "?hotel_id=" + hotelId.value : ""))
	reviews.value = reviewHotelId.value ? await api(`/hotels/${reviewHotelId.value}/reviews`) : null
}
async function removeReview(r) {
	await del("/reviews/" + r.id)
	await load()
}
onMounted(async () => {
	hotels.value = await api("/hotels")
	await load()
})

const STAGES = [
	["expected", "Ожидается", "var(--color-blue)"],
	["checked_in", "Проживает", "var(--color-green)"],
	["checked_out", "Выехал", "var(--color-gray)"],
	["cancelled", "Отменён", "var(--color-red)"],
]

const occ = computed(() => d.value?.occupancy || [])
const occPath = computed(() => {
	const a = occ.value
	if (!a.length) return { line: "", area: "" }
	const W = 600, H = 140, pad = 4
	const max = Math.max(100, ...a.map((x) => x.load))
	const pts = a.map((x, i) => {
		const px = pad + (i / (a.length - 1)) * (W - pad * 2)
		const py = H - pad - (x.load / max) * (H - pad * 2)
		return [px, py]
	})
	const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")
	const area = line + ` L${(W - pad).toFixed(1)} ${H - pad} L${pad} ${H - pad} Z`
	return { line, area }
})

const stageTotal = computed(() => STAGES.reduce((s, [k]) => s + (d.value?.stages[k] || 0), 0))
const donut = computed(() => {
	const total = stageTotal.value || 1
	let acc = 0
	const R = 54, C = 2 * Math.PI * R
	return STAGES.map(([k, label, color]) => {
		const val = d.value?.stages[k] || 0
		const frac = val / total
		const seg = { color, label, val, dash: `${(frac * C).toFixed(2)} ${C.toFixed(2)}`, offset: (-acc * C).toFixed(2) }
		acc += frac
		return seg
	})
})

const maxCompany = computed(() => Math.max(1, ...(d.value?.byCompany || []).map((c) => c.count)))
const maxMove = computed(() => Math.max(1, ...(d.value?.movements || []).flatMap((m) => [m.arrivals, m.departures])))
function dm(date) {
	const p = date.split("-")
	return `${p[2]}.${p[1]}`
}
</script>

<template>
	<div v-if="!d" class="muted">Загрузка…</div>
	<div v-else class="grid">
		<div class="spread">
			<div>
				<h1>Аналитика</h1>
				<p class="muted" style="margin-top: 2px">Загрузка и движение фонда · на {{ d.date }}</p>
			</div>
			<select v-model="hotelId" style="width: auto" @change="load"><option value="">Все гостиницы</option><option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option></select>
		</div>

		<div class="kpis">
			<div class="kpi accent"><div class="v">{{ d.totals.load }}%</div><div class="l">Загрузка сегодня</div></div>
			<div class="kpi"><div class="v">{{ d.totals.occupied }}</div><div class="l">Занято мест</div></div>
			<div class="kpi"><div class="v">{{ d.totals.free }}</div><div class="l">Свободно</div></div>
			<div class="kpi"><div class="v">{{ d.totals.bedNights }}</div><div class="l">Койко-ночей (30 дн.)</div></div>
		</div>

		<div class="card">
			<div class="section-title">Загрузка · 30 дней</div>
			<svg class="chart" viewBox="0 0 600 140" preserveAspectRatio="none">
				<line v-for="y in [0, 0.5, 1]" :key="y" x1="0" :y1="4 + y * 132" x2="600" :y2="4 + y * 132" stroke="var(--color-divider)" stroke-width="1" />
				<path :d="occPath.area" fill="var(--color-brand-highlight)" />
				<path :d="occPath.line" fill="none" stroke="var(--color-brand)" stroke-width="2" />
			</svg>
			<div class="xaxis"><span>{{ dm(occ[0].date) }}</span><span>{{ dm(occ[Math.floor(occ.length / 2)].date) }}</span><span>{{ dm(occ[occ.length - 1].date) }}</span></div>
		</div>

		<div class="cols">
			<div class="card">
				<div class="section-title">Стадии броней</div>
				<div class="donut-wrap">
					<svg viewBox="0 0 140 140" class="donut">
						<g transform="rotate(-90 70 70)">
							<circle cx="70" cy="70" r="54" fill="none" stroke="var(--color-bg)" stroke-width="18" />
							<circle v-for="s in donut" :key="s.label" cx="70" cy="70" r="54" fill="none" :stroke="s.color" stroke-width="18" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
						</g>
						<text x="70" y="66" text-anchor="middle" class="donut-num">{{ stageTotal }}</text>
						<text x="70" y="84" text-anchor="middle" class="donut-lbl">броней</text>
					</svg>
					<div class="legend-list">
						<div v-for="s in donut" :key="s.label" class="leg"><span class="dot" :style="{ background: s.color }" /> {{ s.label }} <b>{{ s.val }}</b></div>
					</div>
				</div>
			</div>

			<div class="card">
				<div class="section-title">Загрузка по гостиницам</div>
				<p v-if="!d.byHotel.length" class="muted">Нет данных.</p>
				<div v-for="h in d.byHotel" :key="h.name" style="margin-bottom: var(--gap-md)">
					<div class="spread" style="font-size: var(--font-size-sm)"><span>{{ h.name }}</span><b>{{ h.occupied }}/{{ h.beds }} · {{ h.load }}%</b></div>
					<div class="bar"><div class="bar-fill" :style="{ width: h.load + '%' }" /></div>
				</div>
			</div>
		</div>

		<div class="cols">
			<div class="card">
				<div class="section-title">Топ организаций</div>
				<p v-if="!d.byCompany.length" class="muted">Нет проживающих.</p>
				<div v-for="c in d.byCompany" :key="c.company" class="company">
					<span class="cname">{{ c.company }}</span>
					<div class="bar"><div class="bar-fill alt" :style="{ width: (c.count / maxCompany) * 100 + '%' }" /></div>
					<b>{{ c.count }}</b>
				</div>
			</div>

			<div class="card">
				<div class="section-title">Заезды и выезды · 14 дней</div>
				<div class="moves">
					<div v-for="m in d.movements" :key="m.date" class="mcol" :title="`${m.date}: +${m.arrivals} / -${m.departures}`">
						<div class="mbars">
							<div class="mb arr" :style="{ height: (m.arrivals / maxMove) * 100 + '%' }" />
							<div class="mb dep" :style="{ height: (m.departures / maxMove) * 100 + '%' }" />
						</div>
						<span class="mx">{{ dm(m.date).slice(0, 2) }}</span>
					</div>
				</div>
				<div class="legend-list" style="flex-direction: row; gap: var(--gap-lg); margin-top: var(--gap-sm)">
					<div class="leg"><span class="dot" style="background: var(--color-green)" /> заезды</div>
					<div class="leg"><span class="dot" style="background: var(--color-orange)" /> выезды</div>
				</div>
			</div>
		</div>

		<div v-if="reviews" class="card">
			<div class="spread">
				<div class="section-title" style="margin: 0">Отзывы проживающих</div>
				<div v-if="reviews.average" class="row" style="gap: 6px"><Stars :model-value="reviews.average" readonly /> <b>{{ reviews.average }}</b> <span class="muted">({{ reviews.count }})</span></div>
			</div>
			<p v-if="!reviews.reviews.length" class="muted" style="margin-top: var(--gap-sm)">Отзывов пока нет.</p>
			<div v-else class="grid" style="gap: var(--gap-sm); margin-top: var(--gap-md)">
				<div v-for="rv in reviews.reviews" :key="rv.id" class="review">
					<div class="spread">
						<div class="row" style="gap: 6px"><Stars :model-value="rv.rating" readonly size="1rem" /> <b>{{ rv.resident_name || "Аноним" }}</b></div>
						<div class="row" style="gap: var(--gap-sm)"><span class="muted" style="font-size: var(--font-size-xs)">{{ rv.created_at?.slice(0, 10) }}</span><button v-if="canEdit" class="btn btn-sm btn-danger" @click="removeReview(rv)"><Icon name="x" /></button></div>
					</div>
					<p v-if="rv.text" class="muted" style="margin: 4px 0 0">{{ rv.text }}</p>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.kpis {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: var(--gap-md);
}
.kpi {
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	padding: var(--gap-md) var(--gap-lg);
	box-shadow: var(--shadow-card);
}
.kpi.accent {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
}
.kpi .v {
	font-size: var(--font-size-xl);
	font-weight: 800;
	color: var(--color-contrast);
}
.kpi.accent .v {
	color: var(--color-brand);
}
.kpi .l {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.chart {
	width: 100%;
	height: 140px;
	display: block;
}
.xaxis {
	display: flex;
	justify-content: space-between;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	margin-top: 4px;
}
.cols {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-lg);
}
.bar {
	height: 8px;
	background: var(--color-bg);
	border-radius: var(--radius-max);
	overflow: hidden;
	margin-top: 4px;
}
.bar-fill {
	height: 100%;
	background: var(--color-green);
	border-radius: var(--radius-max);
}
.bar-fill.alt {
	background: var(--color-brand);
}
.donut-wrap {
	display: flex;
	gap: var(--gap-lg);
	align-items: center;
	flex-wrap: wrap;
}
.donut {
	width: 140px;
	height: 140px;
	flex-shrink: 0;
}
.donut-num {
	font-size: 24px;
	font-weight: 800;
	fill: var(--color-contrast);
}
.donut-lbl {
	font-size: 11px;
	fill: var(--color-secondary);
}
.legend-list {
	display: flex;
	flex-direction: column;
	gap: var(--gap-xs);
}
.leg {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-sm);
}
.leg .dot {
	width: 10px;
	height: 10px;
	border-radius: var(--radius-max);
}
.review {
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.company {
	display: grid;
	grid-template-columns: 1fr 2fr auto;
	gap: var(--gap-sm);
	align-items: center;
	margin-bottom: var(--gap-sm);
	font-size: var(--font-size-sm);
}
.cname {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.moves {
	display: flex;
	align-items: flex-end;
	gap: 4px;
	height: 120px;
}
.mcol {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	height: 100%;
	justify-content: flex-end;
	gap: 2px;
}
.mbars {
	display: flex;
	align-items: flex-end;
	gap: 2px;
	height: 100%;
	width: 100%;
	justify-content: center;
}
.mb {
	width: 6px;
	min-height: 2px;
	border-radius: 2px 2px 0 0;
}
.mb.arr {
	background: var(--color-green);
}
.mb.dep {
	background: var(--color-orange);
}
.mx {
	font-size: 0.6rem;
	color: var(--color-secondary);
}
@media (max-width: 800px) {
	.cols {
		grid-template-columns: 1fr;
	}
}
</style>
