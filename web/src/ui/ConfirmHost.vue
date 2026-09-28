<script setup>
import { ref, computed, watch, nextTick } from "vue"
import { confirmState, resolveConfirm } from "./confirm.js"
import Button from "./Button.vue"
import Icon from "@/components/Icon.vue"

const typed = ref("")
const input = ref(null)
const okBtn = ref(null)
const locked = computed(() => !!confirmState.opts.typeText && typed.value.trim() !== confirmState.opts.typeText)

watch(
	() => confirmState.open,
	async (open) => {
		if (!open) return
		typed.value = ""
		await nextTick()
		// Для опасного действия фокус в поле ввода, а не на кнопке: Enter по привычке ничего не удалит
		if (confirmState.opts.typeText) input.value?.focus()
		else okBtn.value?.$el?.focus()
	},
)

function onKey(e) {
	if (e.key === "Escape") {
		e.preventDefault()
		resolveConfirm(false)
	}
	if (e.key === "Enter" && !locked.value) resolveConfirm(true)
}
</script>

<template>
	<Teleport to="body">
		<div v-if="confirmState.open" class="k-confirm" @keydown="onKey">
			<div class="k-confirm__scrim" @click="resolveConfirm(false)" />
			<div class="k-confirm__box" :class="{ danger: confirmState.opts.danger }" role="alertdialog" aria-modal="true">
				<div v-if="confirmState.opts.danger" class="k-confirm__icon"><Icon name="alert-triangle" size="1.3rem" /></div>
				<h3 class="k-confirm__title">{{ confirmState.opts.title }}</h3>
				<p v-if="confirmState.opts.message" class="k-confirm__msg">{{ confirmState.opts.message }}</p>
				<label v-if="confirmState.opts.typeText" class="k-confirm__type">
					<span>Для подтверждения введите <b>{{ confirmState.opts.typeText }}</b></span>
					<input ref="input" v-model="typed" class="k-confirm__input" autocomplete="off" spellcheck="false" />
				</label>
				<div class="k-confirm__actions">
					<Button variant="ghost" @click="resolveConfirm(false)">{{ confirmState.opts.cancelLabel }}</Button>
					<Button ref="okBtn" :variant="confirmState.opts.danger ? 'danger' : 'primary'" :disabled="locked" @click="resolveConfirm(true)">
						{{ confirmState.opts.confirmLabel }}
					</Button>
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
	backdrop-filter: blur(2px);
	animation: k-fade var(--speed) ease;
}
.k-confirm__box {
	position: relative;
	width: 100%;
	max-width: 420px;
	background: var(--color-raised-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-floating);
	padding: var(--gap-xl);
	animation: k-pop var(--speed) ease;
}
.k-confirm__icon {
	display: grid;
	place-items: center;
	width: 2.6rem;
	height: 2.6rem;
	margin-bottom: var(--gap-md);
	border-radius: 50%;
	color: var(--color-red);
	background: var(--color-red-bg);
}
.k-confirm__title {
	font-size: var(--font-size-lg);
	color: var(--color-contrast);
}
.k-confirm__msg {
	margin: var(--gap-sm) 0 0;
	color: var(--color-secondary);
	white-space: pre-line;
}
.k-confirm__type {
	display: grid;
	gap: var(--gap-xs);
	margin-top: var(--gap-lg);
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
}
.k-confirm__type b {
	color: var(--color-contrast);
	font-family: var(--font-mono, ui-monospace, monospace);
	user-select: all;
}
.k-confirm__input {
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-family: var(--font-mono, ui-monospace, monospace);
}
.k-confirm__input:focus {
	outline: none;
	border-color: var(--color-red);
	box-shadow: 0 0 0 3px var(--color-red-bg);
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
