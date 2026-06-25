<script setup>
defineProps({ title: String, wide: Boolean })
const emit = defineEmits(["close"])
</script>

<template>
	<div class="overlay" @click.self="emit('close')">
		<div class="modal" :class="{ wide }">
			<h3 class="modal-head">{{ title }}</h3>
			<div class="modal-body"><slot /></div>
			<div v-if="$slots.foot" class="modal-foot"><slot name="foot" /></div>
		</div>
	</div>
</template>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.55);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	z-index: 100;
}
.modal {
	width: 100%;
	max-width: 520px;
	max-height: 88vh;
	overflow: auto;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating);
}
.modal.wide {
	max-width: 720px;
}
.modal-head {
	padding: var(--gap-lg) var(--gap-xl);
	border-bottom: 1px solid var(--color-divider);
}
.modal-body {
	padding: var(--gap-xl);
	display: grid;
	gap: var(--gap-md);
	grid-template-columns: minmax(0, 1fr);
}
.modal-foot {
	padding: var(--gap-lg) var(--gap-xl);
	border-top: 1px solid var(--color-divider);
	display: flex;
	justify-content: flex-end;
	gap: var(--gap-sm);
}
</style>
