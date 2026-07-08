<script setup>
import { ref, computed } from "vue"
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
})

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
							<Icon v-if="c.sortable && sortKey === c.key" :name="sortDir > 0 ? 'chevron-right' : 'chevron-left'" size="0.85em" class="k-th__sort" />
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
				<tr v-for="row in sorted" :key="row[rowKey]" @click="$emit('row-click', row)">
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
@keyframes k-shimmer {
	0% {
		background-position: 100% 50%;
	}
	100% {
		background-position: 0 50%;
	}
}
</style>
