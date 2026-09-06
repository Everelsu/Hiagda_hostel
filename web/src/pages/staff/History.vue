<script setup>
/**
 * История размещений: кто где жил и кто заезжает/выезжает.
 * Вместо голой таблицы — сводка за период, понятные карточки и день заездов/выездов.
 */
import { ref, onMounted, computed, watch } from "vue"
import { api, download } from "@/api/client"
import { today, addDays } from "@/utils/date"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Tabs, Input, Select, Button, IconButton, Chip, StatusDot, EmptyState, Skeleton } from "@/ui"

const tab = ref("journal")
const hotels = ref([])
const loading = ref(true)

/* журнал */
const q = ref("")
const hotelId = ref("")
const stage = ref("")
const from = ref("")
const to = ref("")
const rows = ref([])

/* заезды/выезды */
const day = ref(today())
const moves = ref(null)
const movesLoading = ref(false)

const STAGES = { expected: "Ожидается", checked_in: "Проживает", checked_out: "Выехал", cancelled: "Отменён" }
const STAGE_COLOR = {
	expected: "var(--color-blue)",
	checked_in: "var(--color-green)",
	checked_out: "var(--color-gray)",
	cancelled: "var(--color-red)",
}

const tabs = computed(() => [
	{ value: "journal", label: "Журнал", icon: "book", count: rows.value.length },
	{ value: "moves", label: "Заезды и выезды", icon: "key" },
])

onMounted(async () => {
	hotels.value = await api("/hotels")
	await Promise.all([loadJournal(), loadMoves()])
	loading.value = false
})

let timer
function onSearch() {
	clearTimeout(timer)
	timer = setTimeout(loadJournal, 250)
}

async function loadJournal() {
	const qs = new URLSearchParams()
	if (q.value) qs.set("q", q.value)
	if (hotelId.value) qs.set("hotel_id", hotelId.value)
	if (stage.value) qs.set("stage", stage.value)
	if (from.value && to.value) {
		qs.set("from", from.value)
		qs.set("to", to.value)
	}
	rows.value = await api("/journal?" + qs)
}
async function loadMoves() {
	movesLoading.value = true
	try {
		moves.value = await api("/movements?date=" + day.value)
	} finally {
		movesLoading.value = false
	}
}
watch(day, loadMoves)

function resetFilters() {
	q.value = ""
	hotelId.value = ""
	stage.value = ""
	from.value = ""
	to.value = ""
	loadJournal()
}
const hasFilters = computed(() => !!(q.value || hotelId.value || stage.value || (from.value && to.value)))

// Сводка по тому, что реально видно в списке
const summary = computed(() => {
	const uniq = new Set(rows.value.map((r) => r.resident_id).filter(Boolean))
	const nights = rows.value.reduce((s, r) => s + Math.max(0, Math.round((new Date(r.date_to) - new Date(r.date_from)) / 86400000)), 0)
	return {
		total: rows.value.length,
		people: uniq.size,
		nights,
		live: rows.value.filter((r) => r.stage === "checked_in").length,
	}
})

// Группируем по месяцу заезда — так история читается, а не сливается
const groups = computed(() => {
	const out = []
	for (const r of rows.value) {
		const d = new Date(r.date_from)
		const key = `${d.getFullYear()}-${d.getMonth()}`
		const label = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
		let g = out.find((x) => x.key === key)
		if (!g) out.push((g = { key, label, items: [] }))
		g.items.push(r)
	}
	return out
})

function nights(r) {
	return Math.max(0, Math.round((new Date(r.date_to) - new Date(r.date_from)) / 86400000))
}
function fmt(d) {
	return d ? new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—"
}
function personReport(r) {
	if (!r.resident_id) return toast.error("Профиль не привязан")
	download("/report/resident/" + r.resident_id)
}
function shiftDay(n) {
	day.value = addDays(day.value, n)
}
const isToday = computed(() => day.value === today())
</script>

<template>
	<div class="grid">
		<PageHeader title="История размещений" subtitle="Кто где жил, кто заезжает и выезжает" icon="book" />

		<Tabs v-model="tab" :options="tabs" />

		<!-- ЖУРНАЛ -->
		<template v-if="tab === 'journal'">
			<Card pad="md" class="filters">
				<Input v-model="q" placeholder="ФИО, номер или организация…" class="f-search" @input="onSearch" />
				<Select v-model="hotelId" style="width: auto" @change="loadJournal">
					<option value="">Все дома</option>
					<option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
				</Select>
				<Select v-model="stage" style="width: auto" @change="loadJournal">
					<option value="">Любая стадия</option>
					<option v-for="(l, k) in STAGES" :key="k" :value="k">{{ l }}</option>
				</Select>
				<Input v-model="from" type="date" style="width: auto" @change="loadJournal" />
				<Input v-model="to" type="date" style="width: auto" @change="loadJournal" />
				<Button v-if="hasFilters" variant="ghost" icon="x" @click="resetFilters">Сбросить</Button>
			</Card>

			<div class="stats">
				<div><b>{{ summary.total }}</b><span>размещений</span></div>
				<div><b>{{ summary.people }}</b><span>человек</span></div>
				<div><b>{{ summary.live }}</b><span>сейчас проживают</span></div>
				<div><b>{{ summary.nights }}</b><span>койко-суток</span></div>
			</div>

			<Skeleton v-if="loading" variant="card" />
			<Card v-else-if="!rows.length">
				<EmptyState icon="book" title="Ничего не найдено" :text="hasFilters ? 'Попробуйте изменить фильтры.' : 'Размещений пока нет.'" />
			</Card>

			<section v-for="g in groups" v-else :key="g.key">
				<h3 class="gtitle">{{ g.label }} <span class="muted">· {{ g.items.length }}</span></h3>
				<div class="rows">
					<div v-for="r in g.items" :key="r.id" class="hrow" :class="r.stage">
						<StatusDot :color="STAGE_COLOR[r.stage]" size="10px" />
						<div class="who">
							<span class="name">{{ r.resident_name || "—" }}</span>
							<span class="muted sub">{{ [r.company, r.tab_number && "таб. " + r.tab_number].filter(Boolean).join(" · ") || "—" }}</span>
						</div>
						<div class="where">
							<span class="contrast">{{ r.hotel_name }}</span>
							<span class="muted sub">№ {{ r.room_number }} · {{ r.bed_label }}</span>
						</div>
						<div class="when">
							<span class="contrast">{{ fmt(r.date_from) }} – {{ fmt(r.date_to) }}</span>
							<span class="muted sub">{{ nights(r) }} сут.</span>
						</div>
						<Chip :color="STAGE_COLOR[r.stage]" dot>{{ STAGES[r.stage] }}</Chip>
						<IconButton icon="download" label="Отчёт по человеку" size="sm" @click="personReport(r)" />
					</div>
				</div>
			</section>
		</template>

		<!-- ЗАЕЗДЫ / ВЫЕЗДЫ -->
		<template v-else>
			<Card pad="md" class="dayline">
				<Button size="sm" icon="chevron-left" @click="shiftDay(-1)" />
				<Input v-model="day" type="date" style="width: auto" />
				<Button size="sm" icon="chevron-right" @click="shiftDay(1)" />
				<Button v-if="!isToday" size="sm" @click="day = today()">Сегодня</Button>
				<span class="grow" />
				<span class="muted daysum">
					заездов <b class="contrast">{{ moves?.arrivals.length || 0 }}</b> ·
					выездов <b class="contrast">{{ moves?.departures.length || 0 }}</b>
				</span>
			</Card>

			<Skeleton v-if="movesLoading" variant="card" />
			<div v-else class="cols">
				<section>
					<h3 class="gtitle in"><Icon name="log-out" class="flip" /> Заезды <span class="muted">· {{ moves?.arrivals.length || 0 }}</span></h3>
					<Card v-if="!moves?.arrivals.length"><EmptyState icon="key" title="Заездов нет" text="В этот день никто не заселяется." /></Card>
					<div v-else class="rows">
						<div v-for="r in moves.arrivals" :key="r.id" class="mrow arrive">
							<div class="who">
								<span class="name">{{ r.resident_name || "—" }}</span>
								<span class="muted sub">{{ r.company || "—" }}</span>
							</div>
							<div class="where">
								<span class="contrast">{{ r.hotel_name }}</span>
								<span class="muted sub">№ {{ r.room_number }} · {{ r.bed_label }}</span>
							</div>
							<Chip :color="STAGE_COLOR[r.stage]" dot>{{ STAGES[r.stage] }}</Chip>
						</div>
					</div>
				</section>

				<section>
					<h3 class="gtitle out"><Icon name="log-out" /> Выезды <span class="muted">· {{ moves?.departures.length || 0 }}</span></h3>
					<Card v-if="!moves?.departures.length"><EmptyState icon="key" title="Выездов нет" text="В этот день никто не выезжает." /></Card>
					<div v-else class="rows">
						<div v-for="r in moves.departures" :key="r.id" class="mrow depart">
							<div class="who">
								<span class="name">{{ r.resident_name || "—" }}</span>
								<span class="muted sub">{{ r.company || "—" }}</span>
							</div>
							<div class="where">
								<span class="contrast">{{ r.hotel_name }}</span>
								<span class="muted sub">№ {{ r.room_number }} · {{ r.bed_label }}</span>
							</div>
							<Chip :color="STAGE_COLOR[r.stage]" dot>{{ STAGES[r.stage] }}</Chip>
						</div>
					</div>
				</section>
			</div>
		</template>
	</div>
</template>

<style scoped>
.filters {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.f-search {
	flex: 1;
	min-width: 200px;
}
.stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	gap: var(--gap-sm);
}
.stats div {
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.stats b {
	display: block;
	font-size: var(--font-size-xl);
	font-weight: 800;
	color: var(--color-contrast);
	line-height: 1.1;
}
.stats span {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.gtitle {
	margin: 0 0 var(--gap-sm);
	font-size: var(--font-size-sm);
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--color-secondary);
	display: flex;
	align-items: center;
	gap: 6px;
}
.gtitle.in :deep(svg) {
	color: var(--color-green);
}
.gtitle.out :deep(svg) {
	color: var(--color-orange);
}
.flip {
	transform: rotate(180deg);
}
.rows {
	display: grid;
	gap: var(--gap-xs);
}
.hrow,
.mrow {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-left: 3px solid var(--color-divider);
	border-radius: var(--radius-md);
}
.hrow:hover,
.mrow:hover {
	border-color: color-mix(in srgb, var(--color-brand), transparent 55%);
}
.hrow.checked_in {
	border-left-color: var(--color-green);
}
.hrow.expected {
	border-left-color: var(--color-blue);
}
.hrow.cancelled {
	border-left-color: var(--color-red);
	opacity: 0.6;
}
.mrow.arrive {
	border-left-color: var(--color-green);
}
.mrow.depart {
	border-left-color: var(--color-orange);
}
.who {
	flex: 1.4;
	min-width: 0;
}
.where,
.when {
	flex: 1;
	min-width: 0;
}
.name {
	display: block;
	font-weight: 700;
	color: var(--color-contrast);
	font-size: var(--font-size-sm);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.sub {
	display: block;
	font-size: var(--font-size-xs);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.where .contrast,
.when .contrast {
	font-size: var(--font-size-sm);
}
.dayline {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.daysum {
	font-size: var(--font-size-sm);
}
.cols {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-lg);
	align-items: start;
}
@media (max-width: 900px) {
	.cols {
		grid-template-columns: 1fr;
	}
	.hrow,
	.mrow {
		flex-wrap: wrap;
		gap: var(--gap-sm);
	}
	.who,
	.where,
	.when {
		flex: 1 1 45%;
	}
}
</style>
