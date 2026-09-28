<script setup>
// Фото свёрнуто в миниатюру; нажал — на весь экран, нажал ещё раз или Esc — обратно.
import { ref, watch, onUnmounted } from "vue"
import Icon from "@/components/Icon.vue"

defineProps({ src: { type: String, required: true }, alt: { type: String, default: "Фото" } })
const open = ref(false)

// Перехватываем Esc раньше Drawer, чтобы закрылось только фото
function onKey(e) {
	if (e.key !== "Escape") return
	e.preventDefault()
	e.stopPropagation()
	open.value = false
}
watch(open, (v) => (v ? window.addEventListener("keydown", onKey, true) : window.removeEventListener("keydown", onKey, true)))
onUnmounted(() => window.removeEventListener("keydown", onKey, true))
</script>

<template>
	<button type="button" class="thumb" :aria-label="`${alt}: открыть`" @click="open = true">
		<img :src="src" :alt="alt" loading="lazy" />
		<span class="thumb__zoom"><Icon name="maximize-2" size="0.9rem" /> Открыть</span>
		<!-- Внутри кнопки, чтобы у компонента был один корень (классы снаружи ложатся на миниатюру) -->
		<Teleport to="body">
			<Transition name="lb">
				<div v-if="open" class="lb" role="dialog" aria-modal="true" @click.stop="open = false">
					<img :src="src" :alt="alt" />
					<span class="lb__x" aria-hidden="true"><Icon name="x" /></span>
				</div>
			</Transition>
		</Teleport>
	</button>
</template>

<style scoped>
.thumb {
	position: relative;
	display: block;
	width: 100%;
	max-width: 280px;
	height: 140px;
	padding: 0;
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	overflow: hidden;
	background: var(--color-bg);
	cursor: zoom-in;
	flex-shrink: 0;
}
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	transition: transform 240ms ease;
}
.thumb:hover img {
	transform: scale(1.04);
}
.thumb__zoom {
	position: absolute;
	right: 8px;
	bottom: 8px;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 3px 8px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.6);
	color: #fff;
	font-size: 11px;
	font-weight: 700;
}
.lb {
	position: fixed;
	inset: 0;
	z-index: 10000;
	display: grid;
	place-items: center;
	padding: 16px;
	background: rgba(0, 0, 0, 0.88);
	cursor: zoom-out;
}
.lb img {
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
	border-radius: var(--radius-md);
	box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}
.lb__x {
	position: absolute;
	top: calc(12px + env(safe-area-inset-top));
	right: 12px;
	display: grid;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	border: none;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.15);
	color: #fff;
	cursor: pointer;
}
.lb-enter-active,
.lb-leave-active {
	transition: opacity 200ms ease;
}
.lb-enter-active img,
.lb-leave-active img {
	transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.lb-enter-from,
.lb-leave-to {
	opacity: 0;
}
.lb-enter-from img,
.lb-leave-to img {
	transform: scale(0.92);
}
</style>
