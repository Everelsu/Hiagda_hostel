<script setup>
import { ref } from "vue"

const model = defineModel({ type: [String, Number], default: "" })
defineProps({ invalid: Boolean, type: { type: String, default: "text" } })

// Позволяет родителю ставить фокус (горячие клавиши, автофокус в формах)
const el = ref(null)
defineExpose({
	focus: () => el.value?.focus(),
	select: () => el.value?.select(),
})
</script>

<template>
	<input ref="el" v-model="model" :type="type" class="k-input" :class="{ 'k-input--invalid': invalid }" />
</template>

<style scoped>
.k-input {
	width: 100%;
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	transition: border-color var(--speed-fast), box-shadow var(--speed-fast);
}
.k-input:focus {
	outline: none;
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.k-input--invalid {
	border-color: var(--color-red);
}
.k-input--invalid:focus {
	box-shadow: 0 0 0 3px var(--color-red-bg);
}
</style>
