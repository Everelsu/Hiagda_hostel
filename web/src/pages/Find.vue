<script setup>
import { ref } from "vue"

const q = ref("")
const matches = ref(null)
const selected = ref(null)
const loading = ref(false)

let timer
function onInput() {
	clearTimeout(timer)
	timer = setTimeout(search, 350)
}

async function search() {
	const query = q.value.trim()
	selected.value = null
	matches.value = null
	if (query.length < 2) return
	loading.value = true
	try {
		const res = await fetch("/api/kiosk/lookup?q=" + encodeURIComponent(query))
		const data = await res.json()
		if (query !== q.value.trim()) return
		matches.value = data
		if (data.length === 1) selected.value = data[0]
	} catch {
		matches.value = []
	} finally {
		loading.value = false
	}
}
const PERIOD = { now: "Вы проживаете здесь сейчас", upcoming: "Заезд запланирован", past: "Проживание завершено" }
</script>

<template>
	<div class="find">
		<div class="brand-mark" style="font-size: 1.8rem; justify-content: center"><span class="dot" /> NochOtel</div>
		<h1 style="text-align: center; margin: 1rem 0 0.25rem">Найдите свой номер</h1>
		<p class="muted" style="text-align: center">Введите ФИО или табельный номер</p>

		<input
			v-model="q"
			class="find-input"
			placeholder="Например: Иванов или В-101"
			autofocus
			@input="onInput"
			@keyup.enter="search"
		/>

		<p v-if="loading" class="muted" style="text-align: center">Поиск…</p>

		<div v-if="selected" class="card find-result">
			<div class="muted">{{ selected.full_name }}</div>
			<template v-if="selected.placement">
				<div class="room-no">№ {{ selected.placement.room_number }}</div>
				<p>
					{{ selected.placement.hotel_name }}<template v-if="selected.placement.floor != null">, этаж {{ selected.placement.floor }}</template>
					· {{ selected.placement.bed_label }}
				</p>
				<p class="muted">Период: {{ selected.placement.date_from }} – {{ selected.placement.date_to }}</p>
				<p v-if="PERIOD[selected.placement.period]" class="muted">{{ PERIOD[selected.placement.period] }}</p>
				<span class="chip" :style="{ background: selected.placement.status_color, color: '#000' }">{{ selected.placement.status_name }}</span>
			</template>
			<p v-else class="muted">На сегодня активного размещения не найдено. Обратитесь к коменданту.</p>
			<button class="btn btn-block" style="margin-top: 1rem" @click="selected = null">Назад</button>
		</div>

		<div v-else-if="matches && matches.length > 1" class="card">
			<p class="contrast" style="text-align: center; font-weight: 700">Найдено несколько — выберите себя</p>
			<div class="grid" style="margin-top: 1rem">
				<button v-for="m in matches" :key="m.id" class="btn pick" @click="selected = m">
					<span>👤</span>
					<span class="grow" style="text-align: left">
						<b>{{ m.full_name }}</b>
						<small v-if="m.company" class="muted" style="display: block">{{ m.company }}</small>
					</span>
				</button>
			</div>
		</div>

		<p v-else-if="matches && !matches.length" class="muted" style="text-align: center">
			Никого не найдено. Проверьте написание или обратитесь к коменданту.
		</p>

		<p style="text-align: center; margin-top: 2rem">
			<router-link to="/login">Вход для персонала</router-link>
		</p>
	</div>
</template>

<style scoped>
.find {
	max-width: 640px;
	margin: 0 auto;
	padding: 6vh 20px 40px;
}
.find-input {
	font-size: 1.3rem;
	padding: 1rem 1.25rem;
	margin-top: 1.5rem;
}
.find-result {
	text-align: center;
	margin-top: 1.5rem;
}
.room-no {
	font-size: 3rem;
	font-weight: 800;
	color: var(--color-green);
	margin: 0.5rem 0;
}
.pick {
	padding: 1rem 1.25rem;
	font-size: 1.1rem;
}
</style>
