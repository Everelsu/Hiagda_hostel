<script setup>
import { computed } from "vue"
import Icon from "@/components/Icon.vue"

const props = defineProps({
	variant: { type: String, default: "default" },
	size: { type: String, default: "md" },
	icon: { type: String, default: "" },
	loading: { type: Boolean, default: false },
	block: { type: Boolean, default: false },
	to: { type: [String, Object], default: null },
	type: { type: String, default: "button" },
})

const tag = computed(() => (props.to ? "router-link" : "button"))
const cls = computed(() => ["k-btn", `k-btn--${props.variant}`, `k-btn--${props.size}`, { "k-btn--block": props.block, "k-btn--loading": props.loading }])
</script>

<template>
	<component :is="tag" :to="to" :type="to ? undefined : type" :class="cls" :disabled="!to && (loading || $attrs.disabled)">
		<span v-if="loading" class="k-btn__spin" aria-hidden="true" />
		<Icon v-else-if="icon" :name="icon" />
		<span v-if="$slots.default" class="k-btn__label"><slot /></span>
	</component>
</template>

<style scoped>
.k-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--gap-sm);
	height: var(--control-h-md);
	padding: 0 var(--gap-lg);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-button-bg);
	color: var(--color-base);
	font: inherit;
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	cursor: pointer;
	white-space: nowrap;
	transition: background-color var(--speed-fast), border-color var(--speed-fast), filter var(--speed-fast), transform var(--speed-fast);
}
.k-btn:hover {
	filter: brightness(1.08);
	border-color: var(--color-brand);
}
.k-btn:active {
	transform: translateY(1px);
}
.k-btn:focus-visible {
	outline: none;
	box-shadow: var(--focus-ring);
}
.k-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
	filter: none;
	transform: none;
}
.k-btn--sm {
	height: var(--control-h-sm);
	padding: 0 var(--gap-md);
	font-size: var(--font-size-xs);
}
.k-btn--lg {
	height: var(--control-h-lg);
	padding: 0 var(--gap-xl);
	font-size: var(--font-size-nm);
}
.k-btn--block {
	width: 100%;
}
.k-btn--primary {
	background: var(--color-green);
	border-color: var(--color-green);
	color: #04150b;
}
.k-btn--brand {
	background: var(--color-brand-highlight);
	border-color: var(--color-brand);
	color: var(--color-brand);
}
.k-btn--ghost {
	background: transparent;
}
.k-btn--danger {
	background: transparent;
	border-color: transparent;
	color: var(--color-red);
}
.k-btn--danger:hover {
	background: var(--color-red-bg);
	border-color: transparent;
}
.k-btn__label {
	min-width: 0;
}
.k-btn__spin {
	width: 1em;
	height: 1em;
	border-radius: 50%;
	border: 2px solid currentColor;
	border-right-color: transparent;
	animation: k-spin 0.6s linear infinite;
}
@keyframes k-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
