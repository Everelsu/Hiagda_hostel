<script setup>
defineProps({
	variant: { type: String, default: "text" },
	count: { type: Number, default: 1 },
	width: { type: String, default: "" },
})
</script>

<template>
	<div class="k-skel-wrap">
		<div v-for="n in count" :key="n" class="k-skel" :class="`k-skel--${variant}`" :style="width ? { width } : {}" />
	</div>
</template>

<style scoped>
.k-skel-wrap {
	display: grid;
	gap: var(--gap-sm);
}
.k-skel {
	border-radius: var(--radius-sm);
	background: linear-gradient(90deg, var(--color-button-bg) 25%, var(--color-divider) 37%, var(--color-button-bg) 63%);
	background-size: 400% 100%;
	animation: k-shimmer 1.4s ease infinite;
}
.k-skel--text {
	height: 0.85rem;
	width: 100%;
}
.k-skel--row {
	height: 3.25rem;
	border-radius: var(--radius-md);
}
.k-skel--card {
	height: 7rem;
	border-radius: var(--radius-lg);
}
.k-skel--title {
	height: 1.5rem;
	width: 40%;
}
@keyframes k-shimmer {
	0% {
		background-position: 100% 50%;
	}
	100% {
		background-position: 0 50%;
	}
}
</style>
