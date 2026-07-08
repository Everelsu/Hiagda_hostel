<script setup>
import { ref, onMounted, computed } from "vue"
import { api } from "@/api/client"
import { PageHeader, Card, Stat, MeterBar, Chip, Skeleton, EmptyState } from "@/ui"

const d = ref(null)
onMounted(async () => {
	d.value = await api("/dashboard")
})

const STAGES = [
	["expected", "Ожидается", "var(--color-blue)"],
	["checked_in", "Проживает", "var(--color-green)"],
	["checked_out", "Выехал", "var(--color-gray)"],
	["cancelled", "Отменён", "var(--color-red)"],
]
const peak = computed(() => Math.max(1, ...(d.value?.trend || []).map((x) => x.load)))
function dm(date) {
	const p = date.split("-")
	return `${p[2]}.${p[1]}`
}
</script>

<template>
	<div class="grid">
		<PageHeader title="Главная" :subtitle="d ? `Сводка по гостиницам на ${d.date}` : 'Загрузка…'" icon="gauge" />

		<Skeleton v-if="!d" variant="card" />
		<template v-else>
			<div class="kpis">
				<Stat :value="d.totals.load + '%'" label="Загрузка" accent />
				<Stat :value="d.totals.checkins" label="Заезды сегодня" />
				<Stat :value="d.totals.checkouts" label="Выезды сегодня" />
				<Stat :value="d.totals.inhouse" label="Проживает" />
				<Stat :value="d.totals.free" label="Свободно мест" />
				<Stat :value="d.totals.rooms" label="Номеров" />
			</div>

			<div v-if="d.stages" class="row wrap">
				<Chip v-for="s in STAGES" :key="s[0]" :color="s[2]" dot>{{ s[1] }} <b class="contrast" style="margin-left: 4px">{{ d.stages[s[0]] || 0 }}</b></Chip>
			</div>

			<div class="cols">
				<Card title="Загрузка по гостиницам">
					<EmptyState v-if="!d.hotels.length" icon="building" text="Нет гостиниц" />
					<div v-for="h in d.hotels" :key="h.id" class="hload">
						<div class="spread" style="font-size: var(--font-size-sm)"><span>{{ h.name }}</span><b>{{ h.occupied }}/{{ h.beds }} · {{ h.load }}%</b></div>
						<MeterBar :value="h.load" />
					</div>
				</Card>

				<Card title="Динамика загрузки · 14 дней">
					<div class="trend">
						<div v-for="x in d.trend" :key="x.date" class="tcol" :title="`${x.date}: ${x.occupied} мест · ${x.load}%`">
							<div class="tbar" :class="{ today: x.date === d.date }" :style="{ height: Math.round((x.load / peak) * 100) + '%' }" />
							<span class="tx">{{ dm(x.date) }}</span>
						</div>
					</div>
				</Card>
			</div>
		</template>
	</div>
</template>

<style scoped>
.kpis {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
	gap: var(--gap-md);
}
.cols {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--gap-lg);
	align-items: start;
}
.hload {
	display: grid;
	gap: 4px;
	margin-bottom: var(--gap-md);
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
