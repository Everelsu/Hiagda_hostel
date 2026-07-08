<script setup>
import { confirmState, resolveConfirm } from "./confirm.js"
import Button from "./Button.vue"
</script>

<template>
	<Teleport to="body">
		<div v-if="confirmState.open" class="k-confirm">
			<div class="k-confirm__scrim" @click="resolveConfirm(false)" />
			<div class="k-confirm__box" role="alertdialog" aria-modal="true">
				<h3 class="k-confirm__title">{{ confirmState.opts.title }}</h3>
				<p v-if="confirmState.opts.message" class="k-confirm__msg">{{ confirmState.opts.message }}</p>
				<div class="k-confirm__actions">
					<Button variant="ghost" @click="resolveConfirm(false)">{{ confirmState.opts.cancelLabel }}</Button>
					<Button :variant="confirmState.opts.danger ? 'danger' : 'primary'" @click="resolveConfirm(true)">{{ confirmState.opts.confirmLabel }}</Button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.k-confirm {
	position: fixed;
	inset: 0;
	z-index: var(--z-modal);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: var(--gap-xl);
}
.k-confirm__scrim {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.55);
	animation: k-fade var(--speed) ease;
}
.k-confirm__box {
	position: relative;
	width: 100%;
	max-width: 400px;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating);
	padding: var(--gap-xl);
	animation: k-pop var(--speed) ease;
}
.k-confirm__title {
	font-size: var(--font-size-lg);
	color: var(--color-contrast);
}
.k-confirm__msg {
	margin: var(--gap-sm) 0 0;
	color: var(--color-secondary);
}
.k-confirm__actions {
	display: flex;
	justify-content: flex-end;
	gap: var(--gap-sm);
	margin-top: var(--gap-xl);
}
@keyframes k-fade {
	from {
		opacity: 0;
	}
}
@keyframes k-pop {
	from {
		opacity: 0;
		transform: scale(0.96);
	}
}
</style>
