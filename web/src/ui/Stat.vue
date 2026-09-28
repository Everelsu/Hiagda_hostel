<script setup>
import CountUp from "./CountUp.vue"
defineProps({ value: [String, Number], label: String, accent: Boolean })
</script>

<template>
	<div class="k-stat" :class="{ 'k-stat--accent': accent }">
		<div class="k-stat__value"><CountUp :value="value" /></div>
		<div class="k-stat__label">{{ label }}</div>
	</div>
</template>

<style scoped>
.k-stat {
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	padding: var(--gap-md) var(--gap-lg);
	box-shadow: var(--shadow-card);
}
.k-stat--accent {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
}
.k-stat__value {
	font-size: var(--font-size-xl);
	font-weight: var(--font-weight-extrabold);
	color: var(--color-contrast);
}
.k-stat--accent .k-stat__value {
	color: var(--color-brand);
}
.k-stat__label {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
</style>
