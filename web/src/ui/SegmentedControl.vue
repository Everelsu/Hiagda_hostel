<script setup>
import { ref } from "vue"
import { useIndicator } from "./useIndicator"

const model = defineModel({ type: [String, Number, Boolean], default: "" })
const props = defineProps({ options: { type: Array, default: () => [] } })
const root = ref(null)
const thumb = useIndicator(root, () => [model.value, props.options.map((o) => o.label + o.count)])
</script>

<template>
	<div ref="root" class="k-seg" role="tablist">
		<span class="k-seg__thumb" :style="thumb" aria-hidden="true" />
		<button
			v-for="o in options"
			:key="o.value"
			type="button"
			role="tab"
			:aria-selected="model === o.value"
			class="k-seg__btn"
			:class="{ on: model === o.value }"
			@click="model = o.value"
		>
			{{ o.label }}<span v-if="o.count != null" class="k-seg__count">{{ o.count }}</span>
		</button>
	</div>
</template>

<style scoped>
.k-seg {
	display: inline-flex;
	align-items: stretch;
	gap: 2px;
	height: var(--control-h-md);
	padding: 3px;
	max-width: 100%;
	overflow-x: auto;
	scrollbar-width: none;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	flex-shrink: 0;
}
.k-seg__btn {
	display: inline-flex;
	align-items: center;
	gap: var(--gap-xs);
	border: none;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-sm);
	cursor: pointer;
	white-space: nowrap;
}
.k-seg__btn:hover:not(.on) {
	color: var(--color-contrast);
}
.k-seg__btn.on {
	color: var(--color-brand);
}
/* Подсветка выбранного — одна плашка, которая переезжает */
.k-seg {
	position: relative;
}
.k-seg__btn {
	position: relative;
	z-index: 1;
	transition: color var(--speed);
}
.k-seg__thumb {
	position: absolute;
	left: 0;
	top: 3px;
	bottom: 3px;
	border-radius: var(--radius-sm);
	background: var(--color-brand-highlight);
	transition: transform 260ms cubic-bezier(0.3, 0.7, 0.2, 1), width 260ms cubic-bezier(0.3, 0.7, 0.2, 1);
	pointer-events: none;
}
.k-seg__count {
	font-size: var(--font-size-xs);
	opacity: 0.85;
}
</style>
