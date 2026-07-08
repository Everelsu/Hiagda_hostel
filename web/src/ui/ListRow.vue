<script setup>
defineProps({ interactive: Boolean })
</script>

<template>
	<component :is="interactive ? 'button' : 'div'" class="k-row" :class="{ 'k-row--interactive': interactive }" :type="interactive ? 'button' : undefined">
		<span v-if="$slots.lead" class="k-row__lead"><slot name="lead" /></span>
		<span class="k-row__main">
			<span class="k-row__title"><slot name="title" /></span>
			<span v-if="$slots.sub" class="k-row__sub"><slot name="sub" /></span>
		</span>
		<span v-if="$slots.trail" class="k-row__trail"><slot name="trail" /></span>
	</component>
</template>

<style scoped>
.k-row {
	display: flex;
	align-items: center;
	gap: var(--gap-md);
	width: 100%;
	padding: var(--gap-sm) var(--gap-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	text-align: left;
	color: var(--color-base);
	font: inherit;
}
.k-row--interactive {
	cursor: pointer;
	transition: border-color var(--speed-fast);
}
.k-row--interactive:hover {
	border-color: var(--color-brand);
}
.k-row--interactive:focus-visible {
	outline: none;
	box-shadow: var(--focus-ring);
}
.k-row__lead {
	display: flex;
	flex-shrink: 0;
}
.k-row__main {
	flex: 1;
	min-width: 0;
}
.k-row__title {
	display: block;
	font-weight: var(--font-weight-bold);
	color: var(--color-contrast);
}
.k-row__sub {
	display: block;
	font-size: var(--font-size-sm);
	color: var(--color-secondary);
}
.k-row__trail {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	flex-shrink: 0;
}
</style>
