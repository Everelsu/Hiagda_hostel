<script setup>
import { computed } from "vue"

const props = defineProps({
	src: { type: String, default: "" },
	name: { type: String, default: "" },
	size: { type: String, default: "2.4rem" },
})

const initial = computed(() => (props.name || "?").trim().charAt(0).toUpperCase())
</script>

<template>
	<span class="k-avatar" :style="{ width: size, height: size }">
		<img v-if="src" :src="src" alt="" />
		<span v-else class="k-avatar__initial">{{ initial }}</span>
	</span>
</template>

<style scoped>
.k-avatar {
	display: grid;
	place-items: center;
	border-radius: var(--radius-max);
	background: var(--color-brand-highlight);
	color: var(--color-brand);
	font-weight: var(--font-weight-extrabold);
	overflow: hidden;
	flex-shrink: 0;
}
.k-avatar img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
</style>
