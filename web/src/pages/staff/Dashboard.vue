<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import Icon from "@/components/Icon.vue"
import { PageHeader, Card, Stat, MeterBar, Chip, Skeleton, EmptyState, ListRow, StatusDot, Button } from "@/ui"

const d = ref(null)
const loading = ref(true)

async function load() {
	loading.value = true
	try {
		d.value = await api("/dashboard")
	} finally {
		loading.value = false
	}
}
onMounted(load)

const STAGES = [
	["expected", "Ожидается", "var(--color-blue)"],
	["checked_in", "Проживает", "var(--color-green)"],
	["checked_out", "Выехал", "var(--color-gray)"],
	["cancelled", "Отменён", "var(--color-red)"],
]

const peak = computed(() => Math.max(1, ...(d.value?.trend || []).map((x) => x.load)))
const tension = computed(() => {
	const load = d.value?.totals?.load || 0
	if (load >= 95) return { label: "Критично", color: "var(--color-red)", text: "Свободных мест почти нет — проверьте ожидаемые заезды." }
	if (load >= 80) return { label: "Высокая", color: "var(--color-orange)", text: "Фонд загружен плотно — держите под рукой резервные места." }
	return { label: "Норма", color: "var(--color-green)", text: "Есть запас по местам для новых вахтовиков." }
})
const sortedHotels = computed(() => [...(d.value?.hotels || [])].sort((a, b) => b.load - a.load))
const tightHotels = computed(() => sortedHotels.value.filter((h) => h.free <= 3 || h.load >= 90))

function dm(date) {
	const p = date.split("-")
	return `${p[2]}.${p[1]}`
}
function place(row) {
	return `${row.hotel_name}, № ${row.room_number} · ${row.bed_label}`
}
</script>

<template>
	<div class="grid">
		<PageHeader
			title="Панель размещения"
			:subtitle="d ? `АО «Хиагда» · вахтовое размещение на ${dm(d.date)}` : 'Загрузка сводки…'"
			icon="gauge"
		>
			<template #actions>
				<Button icon="rotate-cw" :loading="loading" @click="load">Обновить</Button>
			</template>
		</PageHeader>

		<Skeleton v-if="!d" variant="card" />
		<template v-else>
			<Card pad="md" class="ops-card">
				<div class="ops-card__main">
					<div>
						<div class="ops-label">Оперативная готовность фонда</div>
						<div class="ops-title">{{ d.totals.occupied }} из {{ d.totals.beds }} мест занято</div>
						<p class="muted">{{ tension.text }}</p>
					</div>
					<Chip :color="tension.color" dot>{{ tension.label }}</Chip>
				</div>
				<MeterBar :value="d.totals.load" />
				<div class="ops-meta">
					<span><b>{{ d.totals.free }}</b> свободно</span>
					<span><b>{{ d.totals.checkins }}</b> заездов сегодня</span>
					<span><b>{{ d.totals.checkouts }}</b> выездов сегодня</span>
					<span><b>{{ d.totals.rooms }}</b> номеров</span>
				</div>
			</Card>

			<div class="kpis">
				<Stat :value="d.totals.load + '%'" label="Загрузка" accent />
				<Stat :value="d.totals.inhouse" label="Проживает" />
				<Stat :value="d.totals.free" label="Свободно мест" />
				<Stat :value="d.totals.checkins" label="Заезды сегодня" />
				<Stat :value="d.totals.checkouts" label="Выезды сегодня" />
				<Stat :value="d.totals.hotels" label="Гостиниц" />
			</div>

			<div class="row wrap">
				<Chip v-for="s in STAGES" :key="s[0]" :color="s[2]" dot>{{ s[1] }} <b class="contrast stage-count">{{ d.stages[s[0]] || 0 }}</b></Chip>
			</div>

			<div class="cols">
				<Card title="Загрузка по гостиницам" subtitle="Сначала самые напряжённые объекты">
					<EmptyState v-if="!sortedHotels.length" icon="building" text="Нет гостиниц" />
					<div v-for="h in sortedHotels" :key="h.id" class="hload">
						<div class="spread hload__head">
							<span class="contrast">{{ h.name }}</span>
							<b>{{ h.occupied }}/{{ h.beds }} · {{ h.load }}%</b>
						</div>
						<MeterBar :value="h.load" />
						<div class="muted hload__sub">{{ h.free }} свободно · {{ h.rooms }} номеров</div>
					</div>
				</Card>

				<Card title="Динамика на 14 дней" subtitle="Прогноз занятости по активным размещениям">
					<div class="trend">
						<div v-for="x in d.trend" :key="x.date" class="tcol" :title="`${x.date}: ${x.occupied} мест · ${x.load}%`">
							<div class="tbar" :class="{ today: x.date === d.date }" :style="{ height: Math.round((x.load / peak) * 100) + '%' }" />
							<span class="tx">{{ dm(x.date) }}</span>
						</div>
					</div>
				</Card>
			</div>

			<div class="cols cols--moves">
				<Card title="Заезды сегодня">
					<EmptyState v-if="!d.arrivals.length" icon="calendar" text="Плановых заездов нет" />
					<ListRow v-for="r in d.arrivals" :key="`${r.hotel_name}-${r.room_number}-${r.bed_label}-${r.resident_name}`">
						<template #lead><StatusDot color="var(--color-blue)" size="12px" /></template>
						<template #title>{{ r.resident_name || "Гость без карточки" }}</template>
						<template #sub>{{ place(r) }}</template>
					</ListRow>
				</Card>

				<Card title="Выезды сегодня">
					<EmptyState v-if="!d.departures.length" icon="calendar" text="Плановых выездов нет" />
					<ListRow v-for="r in d.departures" :key="`${r.hotel_name}-${r.room_number}-${r.bed_label}-${r.resident_name}`">
						<template #lead><StatusDot color="var(--color-orange)" size="12px" /></template>
						<template #title>{{ r.resident_name || "Гость без карточки" }}</template>
						<template #sub>{{ place(r) }}</template>
					</ListRow>
				</Card>
			</div>

			<Card v-if="tightHotels.length" title="Зоны внимания" pad="md">
				<div class="attention">
					<div v-for="h in tightHotels" :key="h.id" class="attention__item">
						<Icon name="building" />
						<span class="grow"><b class="contrast">{{ h.name }}</b><br /><span class="muted">{{ h.free }} свободно из {{ h.beds }} мест</span></span>
						<Chip :color="h.load >= 95 ? 'var(--color-red)' : 'var(--color-orange)'" dot>{{ h.load }}%</Chip>
					</div>
				</div>
			</Card>
		</template>
	</div>
</template>

<style scoped>
.ops-card {
	background: var(--brand-gradient-bg), var(--color-raised-bg);
}
.ops-card__main {
	display: flex;
	justify-content: space-between;
	gap: var(--gap-lg);
	margin-bottom: var(--gap-md);
}
.ops-label {
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.ops-title {
	color: var(--color-contrast);
	font-size: clamp(1.4rem, 4vw, 2.2rem);
	font-weight: var(--font-weight-extrabold);
	line-height: 1.1;
	margin-top: 2px;
}
.ops-card p {
	margin: var(--gap-xs) 0 0;
}
.ops-meta {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap-sm) var(--gap-lg);
	margin-top: var(--gap-md);
	font-size: var(--font-size-sm);
}
.ops-meta b {
	color: var(--color-contrast);
}
.kpis {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
	gap: var(--gap-md);
}
.stage-count {
	margin-left: 4px;
}
.cols {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: var(--gap-lg);
	align-items: start;
}
.cols--moves :deep(.k-card) {
	min-height: 220px;
}
.hload {
	display: grid;
	gap: 5px;
	margin-bottom: var(--gap-md);
}
.hload:last-child {
	margin-bottom: 0;
}
.hload__head {
	font-size: var(--font-size-sm);
}
.hload__sub {
	font-size: var(--font-size-xs);
}
.trend {
	display: flex;
	align-items: flex-end;
	gap: var(--gap-sm);
	height: 180px;
	padding-top: var(--gap-md);
}
.tcol {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--gap-xs);
	height: 100%;
	justify-content: flex-end;
}
.tbar {
	width: 70%;
	min-height: 2px;
	background: linear-gradient(180deg, var(--color-brand), var(--color-blue));
	opacity: 0.6;
	border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.tbar.today {
	opacity: 1;
	box-shadow: 0 0 0 2px var(--color-brand-highlight);
}
.tx {
	font-size: 0.65rem;
	color: var(--color-secondary);
}
.attention {
	display: grid;
	gap: var(--gap-sm);
}
.attention__item {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
}
@media (max-width: 860px) {
	.cols {
		grid-template-columns: 1fr;
	}
	.ops-card__main {
		flex-direction: column;
	}
}
</style>
