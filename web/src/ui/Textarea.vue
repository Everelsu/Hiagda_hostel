<script setup>
const model = defineModel({ type: String, default: "" })
defineProps({ invalid: Boolean, rows: { type: [String, Number], default: 3 } })
</script>

<template>
	<textarea v-model="model" :rows="rows" class="k-textarea" :class="{ 'k-input--invalid': invalid }" />
</template>

<style scoped>
.k-textarea {
	width: 100%;
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	line-height: 1.5;
	resize: vertical;
	transition: border-color var(--speed-fast), box-shadow var(--speed-fast);
}
.k-textarea:focus {
	outline: none;
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.k-input--invalid {
	border-color: var(--color-red);
}
</style>
