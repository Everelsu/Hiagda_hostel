<script setup>
const model = defineModel({ type: [String, Number], default: "" })
defineProps({ invalid: Boolean })
</script>

<template>
	<div class="k-select" :class="{ 'k-input--invalid': invalid }">
		<select v-model="model"><slot /></select>
		<svg class="k-select__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</div>
</template>

<style scoped>
.k-select {
	position: relative;
	display: block;
}
.k-select select {
	width: 100%;
	height: var(--control-h-md);
	padding: 0 2rem 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	appearance: none;
	cursor: pointer;
}
.k-select select:focus {
	outline: none;
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.k-select__arrow {
	position: absolute;
	right: var(--gap-sm);
	top: 50%;
	transform: translateY(-50%);
	width: 1rem;
	height: 1rem;
	color: var(--color-secondary);
	pointer-events: none;
}
.k-input--invalid select {
	border-color: var(--color-red);
}
</style>
