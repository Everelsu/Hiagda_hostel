<script setup>
defineProps({ title: String, subtitle: String, pad: { type: String, default: "lg" }, interactive: Boolean })
</script>

<template>
	<div class="k-card" :class="[`k-card--${pad}`, { 'k-card--interactive': interactive }]">
		<header v-if="title || $slots.actions" class="k-card__head">
			<div class="k-card__titles">
				<h3 v-if="title" class="k-card__title">{{ title }}</h3>
				<p v-if="subtitle" class="k-card__subtitle">{{ subtitle }}</p>
			</div>
			<div v-if="$slots.actions" class="k-card__actions"><slot name="actions" /></div>
		</header>
		<slot />
	</div>
</template>

<style scoped>
.k-card {
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-card);
}
.k-card--lg {
	padding: var(--gap-xl);
}
.k-card--md {
	padding: var(--gap-lg);
}
.k-card--sm {
	padding: var(--gap-md);
}
.k-card--interactive {
	transition: border-color var(--speed-fast), transform var(--speed-fast);
	cursor: pointer;
}
.k-card--interactive:hover {
	border-color: var(--color-brand);
	transform: translateY(-1px);
}
.k-card__head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--gap-md);
	margin-bottom: var(--gap-md);
}
.k-card__title {
	font-size: var(--font-size-lg);
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.k-card__subtitle {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
	margin: 2px 0 0;
}
.k-card__actions {
	display: flex;
	gap: var(--gap-sm);
	flex-shrink: 0;
}
</style>
