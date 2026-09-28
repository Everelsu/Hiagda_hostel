<script setup>
import { ref, computed, watch } from "vue"
import Icon from "@/components/Icon.vue"
import EmptyState from "./EmptyState.vue"

const props = defineProps({
	columns: { type: Array, default: () => [] },
	rows: { type: Array, default: () => [] },
	rowKey: { type: String, default: "id" },
	loading: { type: Boolean, default: false },
	emptyTitle: { type: String, default: "Ничего не найдено" },
	emptyText: { type: String, default: "" },
	emptyIcon: { type: String, default: "info" },
	// Постраничный вывод: сотни строк не рендерим разом. 0 — без страниц.
	pageSize: { type: Number, default: 0 },
})
defineEmits(["row-click"])

const sortKey = ref("")
const sortDir = ref(1)

function toggleSort(col) {
	if (!col.sortable) return
	if (sortKey.value === col.key) sortDir.value *= -1
	else {
		sortKey.value = col.key
		sortDir.value = 1
	}
}

const page = ref(0)
const pages = computed(() => (props.pageSize ? Math.max(1, Math.ceil(sorted.value.length / props.pageSize)) : 1))
const visible = computed(() => (props.pageSize ? sorted.value.slice(page.value * props.pageSize, (page.value + 1) * props.pageSize) : sorted.value))
// Новый фильтр или поиск — снова с первой страницы
watch(() => props.rows, () => (page.value = 0))
const pageNums = computed(() => {
	const n = pages.value
	const c = page.value
	const set = new Set([0, n - 1, c - 1, c, c + 1].filter((i) => i >= 0 && i < n))
	const out = []
	let prev = -1
	for (const i of [...set].sort((a, b) => a - b)) {
		if (i - prev > 1) out.push("…" + i)
		out.push(i)
		prev = i
	}
	return out
})

const sorted = computed(() => {
	if (!sortKey.value) return props.rows
	const k = sortKey.value
	const d = sortDir.value
	return [...props.rows].sort((a, b) => {
		const av = a[k] ?? ""
		const bv = b[k] ?? ""
		if (typeof av === "number" && typeof bv === "number") return (av - bv) * d
		return String(av).localeCompare(String(bv), "ru") * d
	})
})
</script>

<template>
	<div class="k-table-wrap">
		<table class="k-table">
			<thead>
				<tr>
					<th
						v-for="c in columns"
						:key="c.key"
						:style="{ textAlign: c.align || 'left', width: c.width }"
						:class="{ sortable: c.sortable }"
						@click="toggleSort(c)"
					>
						<span class="k-th">
							{{ c.label }}
							<Icon v-if="c.sortable && sortKey === c.key" :name="sortDir > 0 ? 'chevron-up' : 'chevron-down'" size="0.85em" class="k-th__sort" />
						</span>
					</th>
					<th v-if="$slots.actions" class="k-table__actions-col" />
				</tr>
			</thead>
			<tbody v-if="loading">
				<tr v-for="n in 6" :key="n" class="k-table__skelrow">
					<td v-for="c in columns" :key="c.key"><span class="k-table__skel" /></td>
					<td v-if="$slots.actions"><span class="k-table__skel" /></td>
				</tr>
			</tbody>
			<tbody v-else>
				<tr v-for="row in visible" :key="row[rowKey]" @click="$emit('row-click', row)">
					<td v-for="c in columns" :key="c.key" :style="{ textAlign: c.align || 'left' }">
						<slot :name="'cell-' + c.key" :row="row" :value="row[c.key]">{{ row[c.key] }}</slot>
					</td>
					<td v-if="$slots.actions" class="k-table__actions" @click.stop>
						<slot name="actions" :row="row" />
					</td>
				</tr>
			</tbody>
		</table>
		<EmptyState v-if="!loading && !sorted.length" :icon="emptyIcon" :title="emptyTitle" :text="emptyText" />
		<div v-if="pageSize && pages > 1" class="k-pager">
			<span class="k-pager__info">{{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, sorted.length) }} из {{ sorted.length }}</span>
			<span class="k-pager__grow" />
			<button type="button" class="k-pager__btn" :disabled="page === 0" aria-label="Назад" @click="page--"><Icon name="chevron-left" /></button>
			<template v-for="p in pageNums" :key="p">
				<span v-if="typeof p === 'string'" class="k-pager__gap">…</span>
				<button v-else type="button" class="k-pager__btn" :class="{ on: p === page }" @click="page = p">{{ p + 1 }}</button>
			</template>
			<button type="button" class="k-pager__btn" :disabled="page >= pages - 1" aria-label="Вперёд" @click="page++"><Icon name="chevron-right" /></button>
		</div>
	</div>
</template>

<style scoped>
.k-table-wrap {
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	overflow-x: auto;
}
.k-table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--font-size-sm);
}
.k-table th {
	position: sticky;
	top: 0;
	background: var(--color-raised-bg);
	color: var(--color-secondary);
	font-size: var(--font-size-xs);
	text-transform: uppercase;
	letter-spacing: 0.03em;
	font-weight: var(--font-weight-bold);
	padding: var(--gap-sm) var(--gap-md);
	border-bottom: 1px solid var(--color-divider);
	white-space: nowrap;
	z-index: 1;
}
.k-table th.sortable {
	cursor: pointer;
	user-select: none;
}
.k-table th.sortable:hover {
	color: var(--color-contrast);
}
.k-th {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.k-table td {
	padding: var(--gap-sm) var(--gap-md);
	border-bottom: 1px solid var(--color-divider);
	color: var(--color-base);
	vertical-align: middle;
}
.k-table tbody tr:last-child td {
	border-bottom: none;
}
.k-table tbody tr:hover td {
	background: var(--color-bg);
}
.k-table__actions {
	text-align: right;
	white-space: nowrap;
}
.k-table__actions-col {
	width: 1%;
}
.k-table__skel {
	display: block;
	height: 0.9rem;
	border-radius: var(--radius-sm);
	background: var(--color-button-bg);
	animation: k-shimmer 1.4s ease infinite;
	background: linear-gradient(90deg, var(--color-button-bg) 25%, var(--color-divider) 37%, var(--color-button-bg) 63%);
	background-size: 400% 100%;
}
.k-pager {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: var(--gap-sm) var(--gap-md);
	border-top: 1px solid var(--color-divider);
	font-size: var(--font-size-sm);
	position: sticky;
	left: 0;
}
.k-pager__info {
	color: var(--color-secondary);
	font-variant-numeric: tabular-nums;
}
.k-pager__grow {
	flex: 1;
}
.k-pager__btn {
	min-width: 2rem;
	height: 2rem;
	padding: 0 6px;
	display: inline-grid;
	place-items: center;
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}
.k-pager__btn:hover:not(:disabled) {
	background: var(--color-button-bg);
	color: var(--color-contrast);
}
.k-pager__btn.on {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: var(--font-weight-bold);
}
.k-pager__btn:disabled {
	opacity: 0.35;
	cursor: default;
}
.k-pager__gap {
	color: var(--color-secondary);
	padding: 0 2px;
}
@keyframes k-shimmer {
	0% {
		background-position: 100% 50%;
	}
	100% {
		background-position: 0 50%;
	}
}
</style>
