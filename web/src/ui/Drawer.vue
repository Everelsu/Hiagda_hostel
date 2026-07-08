<script setup>
import { onMounted, onUnmounted } from "vue"
import IconButton from "./IconButton.vue"

defineProps({ title: String, subtitle: String, width: { type: String, default: "480px" } })
const emit = defineEmits(["close"])

function onKey(e) {
	if (e.key === "Escape") emit("close")
}
onMounted(() => {
	document.addEventListener("keydown", onKey)
	document.body.style.overflow = "hidden"
})
onUnmounted(() => {
	document.removeEventListener("keydown", onKey)
	document.body.style.overflow = ""
})
</script>

<template>
	<Teleport to="body">
		<div class="k-drawer">
			<div class="k-drawer__scrim" @click="emit('close')" />
			<aside class="k-drawer__panel" :style="{ width }" role="dialog" aria-modal="true">
				<header class="k-drawer__head">
					<div class="k-drawer__titles">
						<h3 class="k-drawer__title">{{ title }}</h3>
						<p v-if="subtitle" class="k-drawer__subtitle">{{ subtitle }}</p>
					</div>
					<IconButton icon="x" label="Закрыть" @click="emit('close')" />
				</header>
				<div class="k-drawer__body"><slot /></div>
				<footer v-if="$slots.foot" class="k-drawer__foot"><slot name="foot" /></footer>
			</aside>
		</div>
	</Teleport>
</template>

<style scoped>
.k-drawer {
	position: fixed;
	inset: 0;
	z-index: var(--z-drawer);
	display: flex;
	justify-content: flex-end;
}
.k-drawer__scrim {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.5);
	animation: k-fade var(--speed) ease;
}
.k-drawer__panel {
	position: relative;
	max-width: 100vw;
	height: 100%;
	display: flex;
	flex-direction: column;
	background: var(--color-raised-bg);
	border-left: 1px solid var(--color-divider);
	box-shadow: var(--shadow-floating);
	animation: k-slide var(--speed) ease;
}
.k-drawer__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
	padding: var(--gap-lg) var(--gap-xl);
	border-bottom: 1px solid var(--color-divider);
}
.k-drawer__title {
	font-size: var(--font-size-lg);
	color: var(--color-contrast);
}
.k-drawer__subtitle {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
	margin: 2px 0 0;
}
.k-drawer__body {
	flex: 1;
	overflow: auto;
	padding: var(--gap-xl);
}
.k-drawer__foot {
	display: flex;
	justify-content: flex-end;
	gap: var(--gap-sm);
	padding: var(--gap-lg) var(--gap-xl);
	border-top: 1px solid var(--color-divider);
}
@keyframes k-fade {
	from {
		opacity: 0;
	}
}
@keyframes k-slide {
	from {
		transform: translateX(100%);
	}
}
@media (max-width: 560px) {
	.k-drawer__panel {
		width: 100vw !important;
	}
}
</style>
