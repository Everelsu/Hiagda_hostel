<script setup>
import Icon from "@/components/Icon.vue"

defineProps({ icon: { type: String, default: "info" }, title: String, text: String })
</script>

<template>
	<div class="k-empty">
		<span class="k-empty__ico"><Icon :name="icon" size="2rem" /></span>
		<div v-if="title" class="k-empty__title">{{ title }}</div>
		<p v-if="text" class="k-empty__text">{{ text }}</p>
		<div v-if="$slots.default" class="k-empty__action"><slot /></div>
	</div>
</template>

<style scoped>
.k-empty {
	display: grid;
	justify-items: center;
	text-align: center;
	gap: var(--gap-xs);
	padding: var(--gap-xl);
	color: var(--color-secondary);
}
.k-empty__ico {
	color: var(--color-secondary);
	opacity: 0.7;
	margin-bottom: var(--gap-xs);
}
.k-empty__title {
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.k-empty__text {
	margin: 0;
	max-width: 32ch;
}
.k-empty__action {
	margin-top: var(--gap-sm);
}
</style>
