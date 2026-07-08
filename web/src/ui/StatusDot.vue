<script setup>
defineProps({ color: { type: String, default: "var(--color-gray)" }, size: { type: String, default: "10px" } })
</script>

<template>
	<span class="k-dot" :style="{ background: color, width: size, height: size }" />
</template>

<style scoped>
.k-dot {
	display: inline-block;
	border-radius: var(--radius-max);
	flex-shrink: 0;
}
</style>
