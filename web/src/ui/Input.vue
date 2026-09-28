<script setup>
import { ref, computed } from "vue"
import Icon from "@/components/Icon.vue"

// Атрибуты вешаем на сам <input> вручную: у поля пароля появляется обёртка,
// и без этого min/placeholder/disabled уехали бы на неё вместо поля.
defineOptions({ inheritAttrs: false })

const model = defineModel({ type: [String, Number], default: "" })
const props = defineProps({ invalid: Boolean, type: { type: String, default: "text" } })

// Позволяет родителю ставить фокус (горячие клавиши, автофокус в формах)
const el = ref(null)
defineExpose({
	focus: () => el.value?.focus(),
	select: () => el.value?.select(),
})

// Пароль можно подсмотреть глазом: выданные пароли набирают с бумажки,
// а вслепую опечатку не видно. По умолчанию поле остаётся скрытым.
const isPassword = computed(() => props.type === "password")
const revealed = ref(false)
const inputType = computed(() => (isPassword.value && revealed.value ? "text" : props.type))
const revealLabel = computed(() => (revealed.value ? "Скрыть пароль" : "Показать пароль"))
</script>

<template>
	<div v-if="isPassword" class="k-input-pw">
		<input
			ref="el"
			v-model="model"
			:type="inputType"
			class="k-input k-input--pw"
			:class="{ 'k-input--invalid': invalid }"
			v-bind="$attrs"
		/>
		<button
			type="button"
			class="k-input__reveal"
			:disabled="$attrs.disabled"
			:aria-label="revealLabel"
			:aria-pressed="revealed"
			:title="revealLabel"
			@mousedown.prevent
			@click.stop="revealed = !revealed"
		>
			<Icon :name="revealed ? 'eye-off' : 'eye'" />
		</button>
	</div>
	<input
		v-else
		ref="el"
		v-model="model"
		:type="type"
		class="k-input"
		:class="{ 'k-input--invalid': invalid }"
		v-bind="$attrs"
	/>
</template>

<style scoped>
.k-input {
	width: 100%;
	height: var(--control-h-md);
	padding: 0 var(--gap-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-button-border);
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: var(--font-size-sm);
	transition: border-color var(--speed-fast), box-shadow var(--speed-fast);
}
.k-input:focus {
	outline: none;
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px var(--color-brand-highlight);
}
.k-input--invalid {
	border-color: var(--color-red);
}
/* Поля только для чтения не должны выглядеть как редактируемые */
.k-input:disabled {
	background: transparent;
	color: var(--color-secondary);
	cursor: not-allowed;
}
.k-input--invalid:focus {
	box-shadow: 0 0 0 3px var(--color-red-bg);
}

.k-input-pw {
	position: relative;
	display: block;
	min-width: 0;
}
/* место под кнопку-глаз, чтобы длинный пароль не заезжал под неё */
.k-input--pw {
	padding-right: var(--control-h-md);
}
.k-input__reveal {
	position: absolute;
	top: 1px;
	right: 1px;
	bottom: 1px;
	width: var(--control-h-md);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	border: none;
	background: transparent;
	color: var(--color-secondary);
	border-radius: 0 var(--radius-md) var(--radius-md) 0;
	cursor: pointer;
}
.k-input__reveal:hover:not(:disabled) {
	color: var(--color-contrast);
}
.k-input__reveal:disabled {
	cursor: default;
	opacity: 0.5;
}
.k-input__reveal:focus-visible {
	outline: 2px solid var(--color-brand);
	outline-offset: -2px;
}
</style>
