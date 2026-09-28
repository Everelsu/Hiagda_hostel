<script setup>
import { ref } from "vue"
import Icon from "@/components/Icon.vue"
import { useIndicator } from "./useIndicator"

const model = defineModel({ type: [String, Number], default: "" })
const props = defineProps({ options: { type: Array, default: () => [] } })
const root = ref(null)
const bar = useIndicator(root, () => [model.value, props.options.map((o) => o.label + o.count)])
</script>

<template>
	<div ref="root" class="k-tabs" role="tablist">
		<span class="k-tabs__bar" :style="bar" aria-hidden="true" />
		<button
			v-for="o in options"
			:key="o.value"
			type="button"
			role="tab"
			:aria-selected="model === o.value"
			class="k-tab"
			:class="{ on: model === o.value }"
			@click="model = o.value"
		>
			<Icon v-if="o.icon" :name="o.icon" />
			{{ o.label }}
			<span v-if="o.count != null" class="k-tab__count">{{ o.count }}</span>
		</button>
	</div>
</template>

<style scoped>
.k-tabs {
	display: flex;
	gap: var(--gap-xs);
	/* Линия-разделитель тенью, а не border: с отрицательным отступом у вкладок
	   появлялся лишний пиксель по вертикали и мини-скроллбар справа. */
	box-shadow: inset 0 -1px 0 var(--color-divider);
	overflow-x: auto;
	overflow-y: hidden;
	scrollbar-width: none;
	/* в колонке с прокруткой (шторка) не сжиматься в ноль из-за overflow */
	flex-shrink: 0;
}
.k-tab {
	display: inline-flex;
	align-items: center;
	gap: var(--gap-xs);
	border: none;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	padding: var(--gap-sm) var(--gap-md);
	border-bottom: 2px solid transparent;
	cursor: pointer;
	transition: color var(--speed);
	white-space: nowrap;
}
.k-tab:hover {
	color: var(--color-contrast);
}
.k-tab.on {
	color: var(--color-brand);
}
/* Подчёркивание одно на всех — переезжает к выбранной вкладке */
.k-tabs {
	position: relative;
}
.k-tabs__bar {
	position: absolute;
	left: 0;
	bottom: 0;
	height: 2px;
	border-radius: 2px;
	background: var(--color-brand);
	transition: transform 260ms cubic-bezier(0.3, 0.7, 0.2, 1), width 260ms cubic-bezier(0.3, 0.7, 0.2, 1);
	pointer-events: none;
}
.k-tab__count {
	font-size: var(--font-size-xs);
	background: var(--color-button-bg);
	border-radius: var(--radius-max);
	padding: 0 6px;
}
</style>
