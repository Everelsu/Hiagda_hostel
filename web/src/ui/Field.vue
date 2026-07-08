<script setup>
defineProps({ label: String, hint: String, error: String })
</script>

<template>
	<label class="k-field">
		<span v-if="label" class="k-field__label">{{ label }}</span>
		<slot />
		<span v-if="error" class="k-field__error">{{ error }}</span>
		<span v-else-if="hint" class="k-field__hint">{{ hint }}</span>
	</label>
</template>

<style scoped>
.k-field {
	display: block;
}
.k-field + .k-field {
	margin-top: var(--gap-md);
}
.k-field__label {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	margin-bottom: var(--gap-xs);
}
.k-field__hint {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	margin-top: var(--gap-xs);
}
.k-field__error {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-red);
	margin-top: var(--gap-xs);
}
</style>
