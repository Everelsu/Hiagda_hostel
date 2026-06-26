<script setup>
defineProps({ images: { type: Array, default: () => [] } })
</script>

<template>
	<div v-if="images.length" class="gallery">
		<a v-for="img in images" :key="img.id || img.url" :href="img.url" target="_blank" rel="noopener" class="gitem">
			<img :src="img.url" loading="lazy" alt="" />
		</a>
	</div>
</template>

<style scoped>
.gallery {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(180px, 1fr);
	gap: var(--gap-sm);
	overflow-x: auto;
	padding-bottom: 4px;
}
.gitem {
	display: block;
	aspect-ratio: 4 / 3;
	border-radius: var(--radius-md);
	overflow: hidden;
	border: 1px solid var(--color-divider);
	background: var(--color-bg);
}
.gitem img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	transition: transform 0.2s;
}
.gitem:hover img {
	transform: scale(1.05);
}
</style>
