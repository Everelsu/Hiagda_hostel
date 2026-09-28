<script setup>
// Подпись + поле. Корень — div, а не <label>: браузер отдаёт клик по <label> первой
// кнопке внутри, и у полей с переключателями (сегменты, выбор дат) вся область вокруг
// «нажимала» первую кнопку. Клик по тексту подписи просто ставит курсор в поле ввода.
import { ref } from "vue"

defineProps({ label: String, hint: String, error: String })
const root = ref(null)
function focusControl() {
	root.value?.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea")?.focus()
}
</script>

<template>
	<div ref="root" class="k-field">
		<span v-if="label" class="k-field__label" @click="focusControl">{{ label }}</span>
		<slot />
		<span v-if="error" class="k-field__error">{{ error }}</span>
		<span v-else-if="hint" class="k-field__hint">{{ hint }}</span>
	</div>
</template>

<style scoped>
.k-field {
	display: block;
	min-width: 0;
}
.k-field__label {
	/* своя строка, но кликабелен только текст */
	display: block;
	width: fit-content;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	margin-bottom: var(--gap-xs);
	cursor: default;
}
.k-field__hint {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	margin-top: var(--gap-xs);
}
.k-field__error {
	display: block;
	font-size: var(--font-size-xs);
	color: var(--color-red);
	margin-top: var(--gap-xs);
	animation: k-field-shake 260ms ease;
}
@keyframes k-field-shake {
	25% {
		transform: translateX(-3px);
	}
	75% {
		transform: translateX(3px);
	}
}
</style>
