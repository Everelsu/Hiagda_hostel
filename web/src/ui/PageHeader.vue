<script setup>
import { useRouter } from "vue-router"
import Icon from "@/components/Icon.vue"

const props = defineProps({ title: String, subtitle: String, icon: String, back: { type: [Boolean, String, Object], default: false } })
const router = useRouter()

function goBack() {
	if (typeof props.back === "string" || typeof props.back === "object") router.push(props.back)
	else router.back()
}
</script>

<template>
	<header class="k-pagehead">
		<button v-if="back" type="button" class="k-pagehead__back" aria-label="Назад" @click="goBack">
			<Icon name="chevron-left" />
		</button>
		<div class="k-pagehead__titles">
			<h1 class="k-pagehead__title"><Icon v-if="icon" :name="icon" /> {{ title }}</h1>
			<p v-if="subtitle" class="k-pagehead__subtitle">{{ subtitle }}</p>
		</div>
		<div v-if="$slots.actions" class="k-pagehead__actions"><slot name="actions" /></div>
	</header>
</template>

<style scoped>
.k-pagehead {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
}
.k-pagehead__back {
	display: grid;
	place-items: center;
	width: var(--control-h-md);
	height: var(--control-h-md);
	border-radius: var(--radius-md);
	border: 1px solid var(--color-divider);
	background: var(--color-raised-bg);
	color: var(--color-base);
	cursor: pointer;
	flex-shrink: 0;
}
.k-pagehead__back:hover {
	border-color: var(--color-brand);
	color: var(--color-contrast);
}
.k-pagehead__titles {
	flex: 1;
	min-width: 0;
}
.k-pagehead__title {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	font-size: var(--font-size-xl);
}
.k-pagehead__subtitle {
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
	margin: 2px 0 0;
}
.k-pagehead__actions {
	display: flex;
	gap: var(--gap-sm);
	flex-shrink: 0;
}
</style>
