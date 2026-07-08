<script setup>
import { toasts } from "@/toast"
import Icon from "@/components/Icon.vue"

const ICON = { success: "check", error: "x", info: "info" }
</script>

<template>
	<Teleport to="body">
		<div class="k-toasts">
			<TransitionGroup name="k-toast">
				<div v-for="t in toasts" :key="t.id" class="k-toast" :class="`k-toast--${t.variant || 'info'}`">
					<Icon :name="ICON[t.variant] || 'info'" class="k-toast__ico" />
					<span>{{ t.message }}</span>
				</div>
			</TransitionGroup>
		</div>
	</Teleport>
</template>

<style scoped>
.k-toasts {
	position: fixed;
	bottom: var(--gap-xl);
	left: 50%;
	transform: translateX(-50%);
	display: grid;
	gap: var(--gap-sm);
	z-index: var(--z-toast);
	width: max-content;
	max-width: 92vw;
}
.k-toast {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	background: var(--surface-4);
	border: 1px solid var(--surface-5);
	color: var(--color-contrast);
	padding: var(--gap-md) var(--gap-lg);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-floating);
	font-size: var(--font-size-sm);
	border-left: 3px solid var(--color-gray);
}
.k-toast--success {
	border-left-color: var(--color-green);
}
.k-toast--success .k-toast__ico {
	color: var(--color-green);
}
.k-toast--error {
	border-left-color: var(--color-red);
}
.k-toast--error .k-toast__ico {
	color: var(--color-red);
}
.k-toast--info .k-toast__ico {
	color: var(--color-blue);
}
.k-toast-enter-active,
.k-toast-leave-active {
	transition: opacity var(--speed), transform var(--speed);
}
.k-toast-enter-from,
.k-toast-leave-to {
	opacity: 0;
	transform: translateY(8px);
}
</style>
