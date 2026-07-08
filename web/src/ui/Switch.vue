<script setup>
const model = defineModel({ type: Boolean, default: false })
defineProps({ label: String, hint: String })
</script>

<template>
	<label class="k-switch">
		<button type="button" role="switch" :aria-checked="model" class="k-switch__track" :class="{ on: model }" @click="model = !model">
			<span class="k-switch__thumb" />
		</button>
		<span v-if="label || hint" class="k-switch__text">
			<span v-if="label" class="k-switch__label">{{ label }}</span>
			<span v-if="hint" class="k-switch__hint">{{ hint }}</span>
		</span>
	</label>
</template>

<style scoped>
.k-switch {
	display: flex;
	align-items: flex-start;
	gap: var(--gap-md);
	cursor: pointer;
}
.k-switch__track {
	flex-shrink: 0;
	width: 2.5rem;
	height: 1.5rem;
	border-radius: var(--radius-max);
	border: none;
	background: var(--color-button-bg);
	position: relative;
	cursor: pointer;
	transition: background-color var(--speed);
}
.k-switch__track.on {
	background: var(--color-brand);
}
.k-switch__track:focus-visible {
	outline: none;
	box-shadow: var(--focus-ring);
}
.k-switch__thumb {
	position: absolute;
	top: 3px;
	left: 3px;
	width: 1.125rem;
	height: 1.125rem;
	border-radius: 50%;
	background: #fff;
	transition: transform var(--speed);
}
.k-switch__track.on .k-switch__thumb {
	transform: translateX(1rem);
}
.k-switch__label {
	display: block;
	font-weight: var(--font-weight-medium);
	color: var(--color-contrast);
}
.k-switch__hint {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
</style>
