<script setup>
import Icon from "@/components/Icon.vue"

defineProps({
	icon: { type: String, required: true },
	label: { type: String, required: true },
	variant: { type: String, default: "ghost" },
	size: { type: String, default: "md" },
})
</script>

<template>
	<button type="button" class="k-iconbtn" :class="[`k-iconbtn--${variant}`, `k-iconbtn--${size}`]" :aria-label="label" :title="label">
		<Icon :name="icon" />
	</button>
</template>

<style scoped>
.k-iconbtn {
	display: inline-grid;
	place-items: center;
	width: var(--control-h-md);
	height: var(--control-h-md);
	border-radius: var(--radius-md);
	border: 1px solid transparent;
	background: transparent;
	color: var(--color-base);
	cursor: pointer;
	transition: background-color var(--speed-fast), color var(--speed-fast);
}
.k-iconbtn--sm {
	width: var(--control-h-sm);
	height: var(--control-h-sm);
	font-size: var(--font-size-sm);
}
.k-iconbtn--lg {
	width: var(--control-h-lg);
	height: var(--control-h-lg);
}
.k-iconbtn:hover {
	background: var(--color-button-bg);
	color: var(--color-contrast);
}
.k-iconbtn:focus-visible {
	outline: none;
	box-shadow: var(--focus-ring);
}
.k-iconbtn--solid {
	background: var(--color-button-bg);
	border-color: var(--color-button-border);
}
.k-iconbtn--danger:hover {
	background: var(--color-red-bg);
	color: var(--color-red);
}
</style>
