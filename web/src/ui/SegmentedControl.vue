<script setup>
const model = defineModel({ type: [String, Number], default: "" })
defineProps({ options: { type: Array, default: () => [] } })
</script>

<template>
	<div class="k-seg" role="tablist">
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
	gap: 2px;
	padding: 3px;
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	flex-wrap: wrap;
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
	padding: var(--gap-xs) var(--gap-md);
	border-radius: var(--radius-sm);
	cursor: pointer;
}
.k-seg__btn.on {
	background: var(--color-brand-highlight);
	color: var(--color-brand);
}
.k-seg__count {
	font-size: var(--font-size-xs);
	opacity: 0.85;
}
</style>
