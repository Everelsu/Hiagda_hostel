<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"

const d = ref(null)
onMounted(async () => {
	d.value = await api("/dashboard")
})

const STAGES = [
	["expected", "Ожидается", "#5fc8ff"],
	["checked_in", "Проживает", "#1bd96a"],
	["checked_out", "Выехал", "#8a93a3"],
	["cancelled", "Отменён", "#ff5c5c"],
]
const peak = computed(() => Math.max(1, ...(d.value?.trend || []).map((x) => x.load)))
function dm(date) {
	const p = date.split("-")
	return `${p[2]}.${p[1]}`
}
</script>

<template>
	<div v-if="!d" class="muted">Загрузка…</div>
	<div v-else class="grid">
		<div>
			<h1>Главная</h1>
			<p class="muted" style="margin-top: 2px">Сводка по гостиницам на {{ d.date }}</p>
		</div>

		<div class="kpis">
			<div class="kpi accent"><div class="v">{{ d.totals.load }}%</div><div class="l">Загрузка</div></div>
			<div class="kpi"><div class="v">{{ d.totals.checkins }}</div><div class="l">Заезды сегодня</div></div>
			<div class="kpi"><div class="v">{{ d.totals.checkouts }}</div><div class="l">Выезды сегодня</div></div>
			<div class="kpi"><div class="v">{{ d.totals.inhouse }}</div><div class="l">Проживает</div></div>
			<div class="kpi"><div class="v">{{ d.totals.free }}</div><div class="l">Свободно мест</div></div>
			<div class="kpi"><div class="v">{{ d.totals.rooms }}</div><div class="l">Номеров</div></div>
		</div>

		<div v-if="d.stages" class="row wrap">
			<div v-for="s in STAGES" :key="s[0]" class="chip stage" :style="{ borderLeft: '3px solid ' + s[2] }">
				<span class="dot" :style="{ background: s[2] }" /> {{ s[1] }} <b>{{ d.stages[s[0]] || 0 }}</b>
			</div>
		</div>

		<div class="cols">
			<div class="card">
				<div class="section-title">Загрузка по гостиницам</div>
				<p v-if="!d.hotels.length" class="muted">Нет гостиниц.</p>
				<div v-for="h in d.hotels" :key="h.id" style="margin-bottom: var(--gap-md)">
					<div class="spread" style="font-size: var(--font-size-sm)"><span>{{ h.name }}</span><b>{{ h.occupied }}/{{ h.beds }} · {{ h.load }}%</b></div>
					<div class="bar"><div class="bar-fill" :style="{ width: h.load + '%' }" /></div>
				</div>
			</div>

			<div class="card">
				<div class="section-title">Динамика загрузки · 14 дней</div>
				<div class="trend">
					<div v-for="x in d.trend" :key="x.date" class="tcol" :title="`${x.date}: ${x.occupied} мест · ${x.load}%`">
						<div class="tbar" :class="{ today: x.date === d.date }" :style="{ height: Math.round((x.load / peak) * 100) + '%' }" />
						<span class="tx">{{ dm(x.date) }}</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.kpis {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
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
.stage {
	background: var(--color-raised-bg);
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
.trend {
	display: flex;
	align-items: flex-end;
	gap: var(--gap-sm);
	height: 160px;
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
	background: var(--color-brand);
	opacity: 0.55;
	border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.tbar.today {
	opacity: 1;
}
.tx {
	font-size: 0.65rem;
	color: var(--color-secondary);
}
@media (max-width: 760px) {
	.cols {
		grid-template-columns: 1fr;
	}
}
</style>
