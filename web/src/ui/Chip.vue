<script setup>
import { computed } from "vue"
import StatusDot from "./StatusDot.vue"

const props = defineProps({
	color: { type: String, default: "" },
	dot: { type: Boolean, default: false },
	solid: { type: Boolean, default: false },
})

const style = computed(() => {
	if (!props.color) return {}
	if (props.solid) return { background: props.color, borderColor: "transparent", color: "#0c0c0c" }
	return { color: props.color, borderColor: props.color }
})
</script>

<template>
	<span class="k-chip" :style="style">
		<StatusDot v-if="dot && color" :color="color" size="8px" />
		<slot />
	</span>
</template>

<style scoped>
.k-chip {
	display: inline-flex;
	align-items: center;
	gap: var(--gap-xs);
	padding: 3px var(--gap-sm);
	border-radius: var(--radius-max);
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
	background: var(--color-button-bg);
	border: 1px solid var(--color-divider);
	white-space: nowrap;
}
</style>
