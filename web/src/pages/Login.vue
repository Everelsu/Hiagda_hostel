<script setup>
import { ref, onMounted, nextTick } from "vue"
import { useRouter, useRoute } from "vue-router"
import { api, post } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import { theme, toggleTheme } from "@/utils/theme"
import BrandMark from "@/components/BrandMark.vue"
import Icon from "@/components/Icon.vue"
import { Input, CountUp } from "@/ui"

// О предприятии — по открытым данным invest-buryatia.ru/hiagada
const STATS = [
	{ n: "1 000", unit: "т", label: "урана в год — проектная мощность", pre: "> " },
	{ n: "585", unit: "", label: "человек работают на предприятии" },
	{ n: "646", unit: "", label: "новых рабочих мест по проекту" },
	{ n: "95", unit: "млрд ₽", label: "инвестиций, проект до 2055 года" },
]
const FACTS = [
	{ icon: "map-pin", k: "Где", v: "Баунтовский эвенкийский район, Республика Бурятия" },
	{ icon: "layout", k: "Что осваивает", v: "Месторождения Хиагдинского рудного поля" },
	{ icon: "droplet", k: "Как добывает", v: "Скважинное подземное выщелачивание — без карьеров и шахт" },
	{ icon: "tag", k: "Что выпускает", v: "Полиуранат аммония («жёлтый кек») и закись-окись урана" },
]

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref("")
const password = ref("")
const fullName = ref("")
const needsSetup = ref(false)
const err = ref("")
const shake = ref(0) // меняем ключ — форма вздрагивает при ошибке
const busy = ref(false)
const capsLock = ref(false)
const userInput = ref(null)
const passInput = ref(null)
const onPassKey = (e) => (capsLock.value = !!e.getModifierState?.("CapsLock"))

onMounted(async () => {
	try {
		needsSetup.value = (await api("/setup-status")).needsSetup
	} catch {}
	// На телефоне не открываем клавиатуру сразу — сначала человек видит экран целиком
	if (matchMedia("(pointer: fine)").matches) userInput.value?.focus()
})

async function submit() {
	if (!username.value.trim()) return userInput.value?.focus()
	if (!password.value) return passInput.value?.focus()
	err.value = ""
	busy.value = true
	try {
		if (needsSetup.value) {
			const r = await post("/register-admin", { username: username.value, password: password.value, full_name: fullName.value })
			auth.setSession(r)
		} else {
			await auth.login(username.value.trim(), password.value)
		}
		router.push(route.query.next || auth.homeRoute)
	} catch (e) {
		err.value = e.message
		shake.value++
		password.value = ""
		await nextTick()
		passInput.value?.focus()
	} finally {
		busy.value = false
	}
}

</script>

<template>
	<div class="auth">
		<!-- Фон: фирменное свечение и линии рельефа — тайга, сопки, Витимское плато -->
		<div class="auth__bg" aria-hidden="true">
			<span class="glow glow--a" />
			<span class="glow glow--b" />
			<svg class="contours" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice">
				<g fill="none" stroke="currentColor" stroke-width="1.2">
					<path v-for="n in 9" :key="n" :d="`M${-60 + n * 8},${420 - n * 26} C ${160 + n * 12},${300 - n * 30} ${300 - n * 6},${560 - n * 22} ${520 + n * 4},${430 - n * 24} S ${760},${250 - n * 16} ${880},${330 - n * 22}`" />
					<ellipse v-for="n in 6" :key="'e' + n" cx="620" cy="620" :rx="40 + n * 34" :ry="26 + n * 24" transform="rotate(-18 620 620)" />
				</g>
			</svg>
		</div>

		<button type="button" class="auth__theme" :aria-label="theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'" @click="toggleTheme">
			<Transition name="spin" mode="out-in"><Icon :key="theme" :name="theme === 'dark' ? 'moon' : 'sun'" size="1.1rem" /></Transition>
		</button>

		<!-- Левая колонка на ПК: знак и о предприятии. На телефоне: знак — над формой, о предприятии — под ней -->
		<div class="left">
			<section class="hero">
				<BrandMark animated size="var(--mark-size)" class="hero__mark" />
				<div>
					<h1 class="hero__title">Хиагда</h1>
					<p class="hero__sub">Учёт вахтовых гостиниц</p>
				</div>
			</section>

			<section class="about">
				<p class="about__lead">
					АО «Хиагда» — предприятие уранового холдинга «Атомредмет-золото», Горнорудный дивизион Госкорпорации «Росатом».
				</p>
				<div class="stats">
					<div v-for="(st, i) in STATS" :key="st.label" class="stat" :style="{ '--i': i }">
						<b>{{ st.pre || "" }}<CountUp :value="st.n" :duration="1200" /><small v-if="st.unit">{{ st.unit }}</small></b>
						<span>{{ st.label }}</span>
					</div>
				</div>
				<dl class="facts">
					<div v-for="(fct, i) in FACTS" :key="fct.k" class="fact" :style="{ '--i': i }">
						<Icon :name="fct.icon" size="1rem" />
						<dt>{{ fct.k }}</dt>
						<dd>{{ fct.v }}</dd>
					</div>
				</dl>
			</section>
		</div>

		<!-- Форма -->
		<main class="panel">
			<form :key="shake" class="card" :class="{ 'card--shake': shake }" novalidate @submit.prevent="submit">
				<h2 class="card__title">{{ needsSetup ? "Создайте администратора" : "Вход" }}</h2>
				<p class="card__hint">{{ needsSetup ? "Этот аккаунт сможет заводить остальных" : "Логин и пароль из листка доступа" }}</p>

				<label class="fld">
					<span class="fld__label">Логин</span>
					<span class="fld__box">
						<Icon name="user" class="fld__ic" />
						<Input ref="userInput" v-model="username" :invalid="!!err" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="next" @keydown.enter.prevent="passInput?.focus()" />
					</span>
				</label>

				<label class="fld">
					<span class="fld__label">Пароль</span>
					<span class="fld__box">
						<Icon name="lock" class="fld__ic" />
						<Input
							ref="passInput"
							v-model="password"
							type="password"
							:invalid="!!err"
							name="password"
							:autocomplete="needsSetup ? 'new-password' : 'current-password'"
							enterkeyhint="go"
							@keyup="onPassKey"
							@keydown="onPassKey"
						/>
					</span>
					<Transition name="drop"><span v-if="capsLock" class="fld__caps"><Icon name="alert-triangle" size="0.9rem" /> Включён Caps Lock</span></Transition>
				</label>

				<label v-if="needsSetup" class="fld">
					<span class="fld__label">ФИО администратора</span>
					<span class="fld__box"><Icon name="user-cog" class="fld__ic" /><Input v-model="fullName" autocomplete="name" /></span>
				</label>

				<Transition name="drop">
					<p v-if="err" class="card__err" role="alert"><Icon name="alert-triangle" size="1rem" /> {{ err }}</p>
				</Transition>

				<button type="submit" class="go" :disabled="busy">
					<span>{{ busy ? "Входим…" : needsSetup ? "Создать и войти" : "Войти" }}</span>
					<Icon :name="busy ? 'rotate-cw' : 'arrow-right'" size="1.1rem" :class="{ spin: busy }" />
				</button>

				<p v-if="!needsSetup" class="card__help">
					<Icon name="info" size="0.95rem" />
					<span>Нет доступа или забыли пароль — обратитесь к&nbsp;коменданту.</span>
				</p>
			</form>
		</main>
	</div>
</template>

<style scoped>
.auth {
	--mark-size: 6.5rem;
	position: relative;
	min-height: 100vh;
	min-height: 100dvh;
	display: grid;
	grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
	overflow: hidden;
	isolation: isolate;
	background: var(--color-bg);
}

/* ---------- фон ---------- */
.auth__bg {
	position: absolute;
	inset: 0;
	z-index: -1;
	pointer-events: none;
}
.glow {
	position: absolute;
	border-radius: 50%;
	filter: blur(80px);
	opacity: 0.55;
	animation: drift 18s ease-in-out infinite alternate;
}
.glow--a {
	width: 46vw;
	height: 46vw;
	left: -12vw;
	top: -14vw;
	background: color-mix(in srgb, var(--color-brand) 55%, transparent);
}
.glow--b {
	width: 34vw;
	height: 34vw;
	left: 26vw;
	bottom: -16vw;
	background: color-mix(in srgb, #3b6fd8 45%, transparent);
	animation-duration: 24s;
	animation-direction: alternate-reverse;
}
:root[data-theme="light"] .glow {
	opacity: 0.3;
}
@keyframes drift {
	to {
		transform: translate(6vw, 4vw) scale(1.12);
	}
}
.contours {
	position: absolute;
	inset: 0;
	width: 58%;
	height: 100%;
	color: var(--color-contrast);
	opacity: 0.07;
	mask-image: linear-gradient(90deg, #000 55%, transparent);
}

.auth__theme {
	position: absolute;
	top: calc(16px + env(safe-area-inset-top));
	right: 16px;
	z-index: 2;
	display: grid;
	place-items: center;
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 50%;
	border: 1px solid var(--color-divider);
	background: color-mix(in srgb, var(--color-raised-bg) 70%, transparent);
	backdrop-filter: blur(8px);
	color: var(--color-contrast);
	cursor: pointer;
}
.spin-enter-active,
.spin-leave-active {
	transition: transform 260ms ease, opacity 200ms ease;
}
.spin-enter-from {
	transform: rotate(-90deg) scale(0.5);
	opacity: 0;
}
.spin-leave-to {
	transform: rotate(90deg) scale(0.5);
	opacity: 0;
}

/* ---------- бренд и о предприятии ---------- */
.left {
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 1.6rem;
	width: 100%;
	max-width: 36rem;
	margin: 0 auto;
	padding: 2rem clamp(2rem, 5vw, 4rem);
}
.hero {
	display: flex;
	align-items: center;
	gap: 1.4rem;
}
.hero__mark {
	filter: drop-shadow(0 12px 40px color-mix(in srgb, var(--color-brand) 45%, transparent));
}
.hero__title {
	margin: 0;
	font-size: clamp(2.2rem, 3.2vw, 2.8rem);
	line-height: 1.1;
	letter-spacing: -0.03em;
	font-weight: 800;
	color: var(--color-contrast);
	text-wrap: balance;
	animation: fade-up 700ms 450ms both;
}
.hero__sub {
	margin: 0.4rem 0 0;
	max-width: 26rem;
	font-size: 1.1rem;
	line-height: 1.55;
	color: var(--color-secondary);
	text-wrap: pretty;
	animation: fade-up 700ms 650ms both;
}
.about {
	display: grid;
	gap: 1.1rem;
	animation: fade-up 700ms 600ms both;
}
.about__lead {
	margin: 0;
	font-size: 1rem;
	line-height: 1.55;
	color: var(--color-base);
}
.stats {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.6rem;
}
.stat {
	display: grid;
	gap: 0.2rem;
	padding: 0.75rem 0.95rem;
	border-radius: 1rem;
	background: color-mix(in srgb, var(--color-raised-bg) 60%, transparent);
	border: 1px solid color-mix(in srgb, var(--color-contrast) 8%, transparent);
	animation: fade-up 600ms both;
	animation-delay: calc(700ms + var(--i) * 90ms);
}
.stat b {
	font-size: 1.65rem;
	font-weight: 800;
	line-height: 1.1;
	letter-spacing: -0.02em;
	color: var(--color-contrast);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
.stat small {
	margin-left: 0.2em;
	font-size: 0.95rem;
	font-weight: 700;
	color: var(--color-brand);
}
.stat > span {
	font-size: var(--font-size-xs);
	line-height: 1.4;
	color: var(--color-secondary);
}
.facts {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.8rem 1rem;
	margin: 0;
}
.fact {
	display: grid;
	grid-template-columns: 1.2rem minmax(0, 1fr);
	column-gap: 0.7rem;
	animation: fade-up 600ms both;
	animation-delay: calc(1000ms + var(--i) * 80ms);
}
.fact :deep(svg) {
	grid-row: span 2;
	margin-top: 2px;
	color: var(--color-brand);
}
.fact dt {
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
}
.fact dd {
	margin: 0;
	font-size: var(--font-size-sm);
	color: var(--color-contrast);
}
.about__src {
	margin: 0;
	font-size: var(--font-size-xs);
	color: var(--color-secondary);
	opacity: 0.7;
}
@keyframes fade-up {
	from {
		opacity: 0;
		transform: translateY(12px);
	}
}

/* ---------- форма ---------- */
.panel {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: clamp(1.5rem, 4vw, 3rem);
}
.card {
	width: 100%;
	max-width: 25rem;
	padding: 2.2rem 2rem;
	border-radius: 1.6rem;
	background: color-mix(in srgb, var(--color-raised-bg) 78%, transparent);
	border: 1px solid color-mix(in srgb, var(--color-contrast) 9%, transparent);
	box-shadow:
		0 30px 80px -20px rgba(0, 0, 0, 0.55),
		inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent);
	backdrop-filter: blur(18px) saturate(1.2);
	-webkit-backdrop-filter: blur(18px) saturate(1.2);
	animation: card-in 700ms 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.card--shake {
	animation: shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
}
@keyframes card-in {
	from {
		opacity: 0;
		transform: translateY(24px) scale(0.98);
	}
}
@keyframes shake {
	20%,
	60% {
		transform: translateX(-8px);
	}
	40%,
	80% {
		transform: translateX(8px);
	}
}
.card__title {
	margin: 0;
	font-size: 1.75rem;
	letter-spacing: -0.025em;
	line-height: 1.15;
	color: var(--color-contrast);
}
.card__hint {
	margin: 0.35rem 0 1.6rem;
	color: var(--color-secondary);
	font-size: var(--font-size-sm);
}
.fld {
	display: grid;
	gap: 0.4rem;
	margin-bottom: 1rem;
}
.fld__label {
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-secondary);
}
.fld__box {
	position: relative;
	display: block;
}
.fld__ic {
	position: absolute;
	left: 0.95rem;
	top: 50%;
	transform: translateY(-50%);
	z-index: 1;
	color: var(--color-secondary);
	pointer-events: none;
	transition: color var(--speed-fast);
}
.fld__box:focus-within .fld__ic {
	color: var(--color-brand);
}
.fld__box :deep(.k-input) {
	height: 3.1rem;
	padding-left: 2.8rem;
	border-radius: 0.95rem;
	font-size: 1rem;
	background: color-mix(in srgb, var(--color-bg) 70%, transparent);
}
.fld__caps {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	font-size: var(--font-size-xs);
	font-weight: 700;
	color: var(--color-orange);
}
.card__err {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin: 0 0 1rem;
	padding: 0.65rem 0.85rem;
	border-radius: 0.8rem;
	background: color-mix(in srgb, var(--color-red) 14%, transparent);
	color: var(--color-red);
	font-size: var(--font-size-sm);
	font-weight: 600;
}
.go {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.6rem;
	width: 100%;
	height: 3.3rem;
	margin-top: 0.4rem;
	border: none;
	border-radius: 1rem;
	background: linear-gradient(135deg, color-mix(in srgb, var(--color-brand) 85%, #fff), var(--color-brand) 45%, color-mix(in srgb, var(--color-brand) 70%, #3b1a80));
	color: var(--color-accent-contrast);
	font: inherit;
	font-size: 1.05rem;
	font-weight: 800;
	cursor: pointer;
	overflow: hidden;
	box-shadow: 0 12px 30px -10px color-mix(in srgb, var(--color-brand) 70%, transparent);
	transition: transform var(--speed-fast), box-shadow var(--speed-fast), filter var(--speed-fast);
}
/* блик пробегает по кнопке при наведении */
.go::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
	transform: translateX(-120%);
	transition: transform 700ms ease;
}
.go:hover:not(:disabled)::after {
	transform: translateX(120%);
}
.go:hover:not(:disabled) {
	box-shadow: 0 16px 36px -10px color-mix(in srgb, var(--color-brand) 85%, transparent);
}
.go:hover:not(:disabled) svg {
	transform: translateX(3px);
}
.go svg {
	transition: transform var(--speed-fast);
}
.go:active:not(:disabled) {
	transform: scale(0.98);
}
.go:disabled {
	filter: saturate(0.6);
	cursor: progress;
}
.go .spin {
	animation: rot 800ms linear infinite;
}
@keyframes rot {
	to {
		transform: rotate(360deg);
	}
}
.card__help {
	display: flex;
	gap: 0.55rem;
	margin: 1.3rem 0 0;
	font-size: var(--font-size-xs);
	line-height: 1.5;
	color: var(--color-secondary);
}
.card__help :deep(svg) {
	flex-shrink: 0;
	margin-top: 1px;
	color: var(--color-brand);
}
.drop-enter-active,
.drop-leave-active {
	transition: opacity 180ms ease, transform 180ms ease;
}
.drop-enter-from,
.drop-leave-to {
	opacity: 0;
	transform: translateY(-4px);
}

/* ---------- телефон и узкие окна: шапка со знаком, форма листом снизу ---------- */
@media (max-width: 900px) {
	.auth {
		--mark-size: 5.2rem;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto auto;
	}
	.contours {
		width: 100%;
		height: 60%;
		mask-image: linear-gradient(180deg, #000 40%, transparent);
	}
	.glow--a {
		width: 90vw;
		height: 90vw;
		left: -30vw;
		top: -40vw;
	}
	.glow--b {
		width: 70vw;
		height: 70vw;
		left: 40vw;
		bottom: auto;
		top: 10vh;
	}
	.left {
		display: contents;
	}
	.hero {
		order: 1;
		flex-direction: column;
		gap: 0;
		text-align: center;
		padding: calc(2.2rem + env(safe-area-inset-top)) 1.5rem 1.6rem;
	}
	.panel {
		order: 2;
	}
	.about {
		order: 3;
		padding: 0.4rem 1.4rem calc(2rem + env(safe-area-inset-bottom));
		background: color-mix(in srgb, var(--color-raised-bg) 78%, transparent);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
		animation: none;
	}
	.stat b {
		font-size: 1.45rem;
	}
	.facts {
		grid-template-columns: minmax(0, 1fr);
	}
	.hero__title {
		margin-top: 1rem;
		font-size: 1.9rem;
	}
	.hero__sub {
		margin: 0.2rem auto 0;
		font-size: 1rem;
	}
	.panel {
		align-items: stretch;
		padding: 0;
	}
	.card {
		max-width: none;
		padding: 1.8rem 1.4rem 1.6rem;
		border-radius: 1.8rem 1.8rem 0 0;
		/* лист продолжается блоком «о предприятии» — без боковых рамок, чтобы не было шва */
		border-width: 1px 0 0;
		box-shadow: 0 -20px 60px -20px rgba(0, 0, 0, 0.5);
		animation-name: sheet-in;
	}
	.card--shake {
		animation: shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
	}
	@keyframes sheet-in {
		from {
			transform: translateY(40%);
			opacity: 0;
		}
	}
	/* на планшете форма не растягивается на всю ширину */
	@media (min-width: 560px) {
		.card,
		.about {
			width: 100%;
			max-width: 30rem;
			margin: 0 auto;
		}
	}
}
@media (prefers-reduced-motion: reduce) {
	.glow,
	.card,
	.hero__title,
	.hero__sub,
	.about,
	.stat,
	.fact {
		animation: none;
	}
}
</style>
