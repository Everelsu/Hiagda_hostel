<script setup>
import { computed, ref, onMounted } from "vue"

const props = defineProps({ value: { type: Number, default: 0 }, color: { type: String, default: "" } })
const shown = ref(false)
onMounted(() => requestAnimationFrame(() => (shown.value = true)))
const pct = computed(() => (shown.value ? Math.max(0, Math.min(100, props.value)) : 0))
const fill = computed(() => props.color || (pct.value >= 95 ? "var(--color-red)" : pct.value >= 70 ? "var(--color-orange)" : "var(--color-green)"))
</script>

<template>
	<div class="k-meter">
		<div class="k-meter__fill" :style="{ width: pct + '%', background: fill }" />
	</div>
</template>

<style scoped>
.k-meter {
	height: 8px;
	background: var(--color-bg);
	border-radius: var(--radius-max);
	overflow: hidden;
}
.k-meter__fill {
	height: 100%;
	border-radius: var(--radius-max);
	transition: width 700ms cubic-bezier(0.2, 0.7, 0.2, 1), background-color var(--speed);
}
</style>
