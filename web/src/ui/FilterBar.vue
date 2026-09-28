<script setup>
// Контейнер-строка для фильтров и поиска над таблицами.
</script>

<template>
	<div class="k-filterbar">
		<slot />
	</div>
</template>

<style scoped>
.k-filterbar {
	display: flex;
	align-items: flex-end;
	gap: var(--gap-sm);
	flex-wrap: wrap;
}
.k-filterbar :deep(.k-input),
.k-filterbar :deep(.k-select) {
	width: auto;
	min-width: 160px;
}
</style>
