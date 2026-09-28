<script setup>
import { onMounted, onUnmounted } from "vue"
import IconButton from "@/ui/IconButton.vue"

// persistent — не закрывать кликом мимо и Esc (например, окно с одноразовыми паролями)
const props = defineProps({ title: String, wide: Boolean, persistent: Boolean })
const emit = defineEmits(["close"])

function dismiss() {
	if (!props.persistent) emit("close")
}
const onKey = (e) => e.key === "Escape" && dismiss()
onMounted(() => document.addEventListener("keydown", onKey))
onUnmounted(() => document.removeEventListener("keydown", onKey))
</script>

<template>
	<div class="overlay" @click.self="dismiss">
		<div class="modal" :class="{ wide }">
			<header class="modal-head">
				<h3>{{ title }}</h3>
				<IconButton icon="x" label="Закрыть" size="sm" @click="emit('close')" />
			</header>
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
	animation: m-fade var(--speed) ease;
}
@keyframes m-fade {
	from {
		opacity: 0;
	}
}
@keyframes m-pop {
	from {
		opacity: 0;
		transform: translateY(6px) scale(0.98);
	}
}
.modal {
	width: 100%;
	max-width: 520px;
	max-height: 88vh;
	/* шапка и кнопки на месте, прокручивается только содержимое */
	display: flex;
	flex-direction: column;
	overflow: hidden;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating);
	animation: m-pop var(--speed) ease;
}
.modal.wide {
	max-width: 720px;
}
.modal-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
	padding: var(--gap-md) var(--gap-md) var(--gap-md) var(--gap-xl);
	border-bottom: 1px solid var(--color-divider);
	flex-shrink: 0;
}
.modal-head h3 {
	font-size: var(--font-size-lg);
}
.modal-body {
	padding: var(--gap-xl);
	overflow-y: auto;
	flex: 1;
	display: grid;
	gap: var(--gap-md);
	grid-template-columns: minmax(0, 1fr);
}
.modal-foot {
	flex-shrink: 0;
	padding: var(--gap-lg) var(--gap-xl);
	border-top: 1px solid var(--color-divider);
	display: flex;
	justify-content: flex-end;
	gap: var(--gap-sm);
}
</style>
