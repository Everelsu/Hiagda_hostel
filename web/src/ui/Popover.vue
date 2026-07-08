<script setup>
import { ref } from "vue"

defineProps({ trigger: { type: String, default: "hover" } })
const open = ref(false)
</script>

<template>
	<span
		class="k-pop"
		@mouseenter="trigger === 'hover' && (open = true)"
		@mouseleave="trigger === 'hover' && (open = false)"
		@click="trigger === 'click' && (open = !open)"
	>
		<slot name="trigger" :open="open" />
		<Transition name="k-pop-fade">
			<span v-if="open" class="k-pop__panel" @click.stop>
				<slot />
			</span>
		</Transition>
	</span>
</template>

<style scoped>
.k-pop {
	position: relative;
	display: inline-flex;
}
.k-pop__panel {
	position: absolute;
	bottom: calc(100% + 8px);
	left: 50%;
	transform: translateX(-50%);
	z-index: var(--z-popover);
	min-width: 180px;
	background: var(--color-super-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-floating);
	padding: var(--gap-sm) var(--gap-md);
	font-size: var(--font-size-sm);
	color: var(--color-base);
	text-align: left;
	white-space: normal;
}
.k-pop__panel::after {
	content: "";
	position: absolute;
	top: 100%;
	left: 50%;
	transform: translateX(-50%);
	border: 6px solid transparent;
	border-top-color: var(--color-super-raised-bg);
}
.k-pop-fade-enter-active,
.k-pop-fade-leave-active {
	transition: opacity var(--speed-fast);
}
.k-pop-fade-enter-from,
.k-pop-fade-leave-to {
	opacity: 0;
}
</style>
