<script setup>
defineProps({ variant: { type: String, default: "brand" } })
</script>

<template>
	<span class="k-badge" :class="`k-badge--${variant}`"><slot /></span>
</template>

<style scoped>
.k-badge {
	display: inline-grid;
	place-items: center;
	min-width: 1.1rem;
	height: 1.1rem;
	padding: 0 0.35rem;
	border-radius: var(--radius-max);
	font-size: 0.7rem;
	font-weight: var(--font-weight-bold);
	line-height: 1;
	color: #fff;
}
.k-badge--brand {
	background: var(--color-brand);
}
.k-badge--danger {
	background: var(--color-red);
}
</style>
