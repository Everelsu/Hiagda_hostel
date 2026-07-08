<script setup>
import Icon from "@/components/Icon.vue"

const model = defineModel({ type: [String, Number], default: "" })
defineProps({ options: { type: Array, default: () => [] } })
</script>

<template>
	<div class="k-tabs" role="tablist">
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
	border-bottom: 1px solid var(--color-divider);
	overflow-x: auto;
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
	margin-bottom: -1px;
	cursor: pointer;
	white-space: nowrap;
}
.k-tab:hover {
	color: var(--color-contrast);
}
.k-tab.on {
	color: var(--color-brand);
	border-bottom-color: var(--color-brand);
}
.k-tab__count {
	font-size: var(--font-size-xs);
	background: var(--color-button-bg);
	border-radius: var(--radius-max);
	padding: 0 6px;
}
</style>
