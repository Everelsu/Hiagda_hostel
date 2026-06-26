<script setup>
const props = defineProps({
	modelValue: { type: Number, default: 0 },
	readonly: { type: Boolean, default: false },
	size: { type: String, default: "1.2rem" },
})
const emit = defineEmits(["update:modelValue"])
const STAR = "M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.1 20.9l1.1-6.5L2.5 9.8l6.5-.9z"
function set(n) {
	if (!props.readonly) emit("update:modelValue", n)
}
</script>

<template>
	<span class="stars" :class="{ ro: readonly }">
		<button
			v-for="n in 5"
			:key="n"
			type="button"
			class="star"
			:class="{ on: n <= Math.round(modelValue) }"
			:disabled="readonly"
			:aria-label="`${n} из 5`"
			@click="set(n)"
		>
			<svg :width="size" :height="size" viewBox="0 0 24 24" :fill="n <= Math.round(modelValue) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
				<path :d="STAR" />
			</svg>
		</button>
	</span>
</template>

<style scoped>
.stars {
	display: inline-flex;
	gap: 1px;
	line-height: 1;
}
.star {
	background: none;
	border: none;
	padding: 0;
	cursor: pointer;
	color: var(--color-divider);
	display: inline-flex;
}
.stars.ro .star {
	cursor: default;
}
.star.on {
	color: var(--color-orange);
}
</style>
