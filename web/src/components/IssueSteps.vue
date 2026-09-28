<script setup>
// Шкала статуса заявки: Новая → В работе → Починено. Видно, на каком шаге заявка,
// без расшифровки цветных меток.
import { computed } from "vue"

const props = defineProps({ status: { type: String, default: "Новая" } })
const STEPS = ["Новая", "В работе", "Починено"]
const step = computed(() => Math.max(0, STEPS.indexOf(props.status)))
</script>

<template>
	<div class="steps" :data-step="step" :aria-label="`Статус: ${status}`">
		<span v-for="(s, k) in STEPS" :key="s" class="step" :class="{ done: k <= step, now: k === step, fixed: step === 2 }">
			<i />{{ s }}
		</span>
	</div>
</template>

<style scoped>
.steps {
	position: relative;
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	margin-top: 4px;
}
.steps::before,
.steps::after {
	content: "";
	position: absolute;
	top: 6px;
	left: 16.6%;
	right: 16.6%;
	height: 2px;
	border-radius: 2px;
	background: var(--color-divider);
}
/* Заполненная часть линии растёт до текущего шага */
.steps::after {
	right: auto;
	width: 0;
	background: var(--color-brand);
	animation: grow 800ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.steps[data-step="1"]::after {
	width: 33.4%;
}
.steps[data-step="2"]::after {
	width: 66.8%;
	background: var(--color-green);
}
@keyframes grow {
	from {
		width: 0;
	}
}
.step {
	position: relative;
	z-index: 1;
	display: grid;
	justify-items: center;
	gap: 4px;
	font-size: 0.68rem;
	color: var(--color-secondary);
}
.step i {
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--color-bg);
	border: 2px solid var(--color-divider);
}
.step.done i {
	background: var(--color-brand);
	border-color: var(--color-brand);
}
.step.fixed.done i {
	background: var(--color-green);
	border-color: var(--color-green);
}
.step.now {
	color: var(--color-contrast);
	font-weight: var(--font-weight-bold);
}
.step.now:not(.fixed) i {
	box-shadow: 0 0 0 4px var(--color-brand-highlight);
	animation: beat 1.8s ease-in-out infinite;
}
@keyframes beat {
	50% {
		box-shadow: 0 0 0 7px transparent;
	}
}
</style>
