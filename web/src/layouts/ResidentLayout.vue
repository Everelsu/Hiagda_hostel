<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useRouter, useRoute } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { post } from "@/api/client"
import { toast } from "@/toast"
import { loadFeed, unread, feed } from "@/api/me"
import { onRealtime } from "@/realtime"
import { theme, toggleTheme } from "@/utils/theme"
import { useIndicator } from "@/ui/useIndicator"
import Icon from "@/components/Icon.vue"
import BrandMark from "@/components/BrandMark.vue"
import Modal from "@/components/Modal.vue"
import { Input, Field, Button } from "@/ui"

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const curPass = ref("")
const newPass = ref("")
const busy = ref(false)

const tabs = [
	{ to: "/me", exact: true, icon: "home", label: "Главная", badge: true },
	{ to: "/me/place", icon: "bed", label: "Жильё" },
	{ to: "/me/issues", icon: "wrench", label: "Заявки" },
	{ to: "/me/profile", icon: "user", label: "Профиль" },
]
const isActive = (t) => (t.exact ? route.path === t.to : route.path.startsWith(t.to))
// План этажа открывается из «Жилья» — в меню подсвечиваем «Жильё»
const activeIndex = computed(() => {
	if (route.path.startsWith("/me/plan")) return 1
	const i = tabs.findIndex((t) => isActive(t))
	return i < 0 ? 0 : i
})

// Подсветка переезжает к выбранной вкладке — и в верхнем меню, и в нижнем
const topNav = ref(null)
const bottomNav = ref(null)
const topThumb = useIndicator(topNav, () => activeIndex.value)
const bottomThumb = useIndicator(bottomNav, () => activeIndex.value)

// Переход между вкладками сдвигается в сторону выбранной: понятно, куда «ушли»
const dir = ref("fwd")
watch(activeIndex, (now, before) => (dir.value = now >= before ? "fwd" : "back"))

// Высота шапки — для закреплённых под ней полос (разделы «Жилья»): вплотную, без щели
const top = ref(null)
const topH = ref(0)
let ro = null
onMounted(() => {
	if (auth.user?.resident_id) loadFeed().catch(() => {})
	const measure = () => (topH.value = top.value?.offsetHeight || 0)
	measure()
	ro = new ResizeObserver(measure)
	ro.observe(top.value)
})
// Новое объявление или движение по заявке — сразу видно, без обновления страницы
const stopRealtime = onRealtime(async (e) => {
	if (!auth.user?.resident_id) return
	if (e.type === "announcements:changed") {
		const before = unread.value
		await loadFeed(true).catch(() => {})
		if (unread.value > before && route.path !== "/me") {
			const a = feed.value?.announcements?.[0]
			toast.action(`Новое объявление${a ? ": " + a.title : ""}`, "Открыть", () => router.push("/me"), "info")
		}
	} else if (e.type === "issues:changed" && !route.path.startsWith("/me/issues")) {
		loadFeed(true).catch(() => {})
		toast.action(e.deleted ? "Комендант удалил заявку" : "Заявка обновилась", "Посмотреть", () => router.push("/me/issues"), "info")
	}
})
onUnmounted(() => {
	ro?.disconnect()
	stopRealtime()
})

function logout() {
	auth.logout()
}
async function changePassword() {
	if (newPass.value.length < 6) return toast.error("Пароль слишком короткий — минимум 6 символов")
	busy.value = true
	try {
		await post("/me/password", { current: curPass.value, next: newPass.value })
		auth.markPasswordChanged()
		curPass.value = newPass.value = ""
		toast.success("Пароль изменён")
	} catch (e) {
		toast.error(e.message)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<div class="res-shell" :style="topH ? { '--res-top-h': topH + 'px' } : null">
		<header ref="top" class="res-top">
			<div class="res-top__inner">
				<router-link to="/me" class="brand-mark"><BrandMark size="1.6rem" /> Хиагда</router-link>
				<nav ref="topNav" class="res-nav">
					<span class="res-nav__thumb" :style="topThumb" aria-hidden="true" />
					<router-link v-for="(t, i) in tabs" :key="t.to" :to="t.to" :class="{ on: activeIndex === i }">
						{{ t.label }}
						<span v-if="t.badge && unread > 0" :key="unread" class="dot-badge">{{ unread }}</span>
					</router-link>
				</nav>
				<button type="button" class="theme-btn" :aria-label="theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'" @click="toggleTheme">
					<Transition name="spin" mode="out-in">
						<Icon :key="theme" :name="theme === 'dark' ? 'moon' : 'sun'" size="1.15rem" />
					</Transition>
				</button>
			</div>
		</header>

		<main class="res-main">
			<router-view v-slot="{ Component, route: r }">
				<Transition :name="'res-' + dir" mode="out-in">
					<component :is="Component" :key="r.path" />
				</Transition>
			</router-view>
		</main>

		<!-- Нижнее меню на телефоне -->
		<nav ref="bottomNav" class="tabbar">
			<span class="tabbar__thumb" :style="bottomThumb" aria-hidden="true" />
			<router-link v-for="(t, i) in tabs" :key="t.to" :to="t.to" class="tab" :class="{ on: activeIndex === i }">
				<span class="tab-ico">
					<Icon :name="t.icon" size="1.35rem" />
					<span v-if="t.badge && unread > 0" :key="unread" class="tab-badge">{{ unread }}</span>
				</span>
				<span class="tab-label">{{ t.label }}</span>
			</router-link>
		</nav>

		<Modal v-if="auth.user?.must_change_password" title="Придумайте свой пароль" persistent>
			<p class="muted" style="margin: 0">Вам выдали временный пароль. Задайте свой — его будете знать только вы.</p>
			<Field label="Выданный пароль"><Input v-model="curPass" type="password" autocomplete="current-password" /></Field>
			<Field label="Новый пароль" hint="Не короче 6 символов"><Input v-model="newPass" type="password" autocomplete="new-password" @keyup.enter="changePassword" /></Field>
			<template #foot>
				<Button variant="ghost" @click="logout">Выйти</Button>
				<Button variant="primary" icon="check" :loading="busy" @click="changePassword">Сохранить и войти</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.res-shell {
	min-height: 100vh;
	min-height: 100dvh;
	/* мягкий фирменный отсвет сверху — кабинет выглядит «своим», а не служебным */
	background: radial-gradient(1200px 380px at 50% -120px, color-mix(in srgb, var(--color-brand) 14%, transparent), transparent 70%), var(--color-bg);
}
.res-top {
	position: sticky;
	top: 0;
	z-index: 10;
	padding: var(--gap-sm) var(--gap-lg);
	padding-top: calc(var(--gap-sm) + env(safe-area-inset-top));
	background: color-mix(in srgb, var(--color-raised-bg) 82%, transparent);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	border-bottom: 1px solid var(--color-divider);
}
.res-top__inner {
	max-width: 860px;
	margin: 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
}
.brand-mark {
	color: var(--color-contrast);
}
.res-nav {
	position: relative;
	display: flex;
	gap: 2px;
	padding: 4px;
	border-radius: var(--radius-max);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
}
.res-nav a {
	position: relative;
	z-index: 1;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 6px var(--gap-md);
	border-radius: var(--radius-max);
	color: var(--color-secondary);
	font-weight: var(--font-weight-bold);
	font-size: var(--font-size-sm);
	transition: color var(--speed);
}
.res-nav a:hover,
.res-nav a.on {
	color: var(--color-contrast);
}
.res-nav__thumb {
	position: absolute;
	top: 4px;
	bottom: 4px;
	left: 0;
	border-radius: var(--radius-max);
	background: var(--color-brand-highlight);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brand) 40%, transparent);
	transition: transform 300ms cubic-bezier(0.3, 0.7, 0.2, 1), width 300ms cubic-bezier(0.3, 0.7, 0.2, 1);
}
.dot-badge {
	display: inline-grid;
	place-items: center;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	border-radius: 999px;
	background: var(--color-red);
	color: #fff;
	font-size: 10px;
	animation: pop 420ms cubic-bezier(0.3, 1.6, 0.5, 1);
}
.theme-btn {
	display: grid;
	place-items: center;
	width: 2.4rem;
	height: 2.4rem;
	border-radius: 50%;
	border: 1px solid var(--color-divider);
	background: var(--color-bg);
	color: var(--color-contrast);
	cursor: pointer;
	transition: transform var(--speed-fast), border-color var(--speed-fast);
}
.theme-btn:hover {
	border-color: var(--color-brand);
}
.theme-btn:active {
	transform: scale(0.9);
}
.spin-enter-active,
.spin-leave-active {
	transition: transform 280ms ease, opacity 200ms ease;
}
.spin-enter-from {
	transform: rotate(-90deg) scale(0.5);
	opacity: 0;
}
.spin-leave-to {
	transform: rotate(90deg) scale(0.5);
	opacity: 0;
}
.res-main {
	/* сдвиг при смене вкладки не должен давать горизонтальную прокрутку */
	overflow-x: clip;
	max-width: 860px;
	margin: 0 auto;
	padding: var(--gap-xl) var(--gap-lg) calc(var(--gap-xl) + 4rem);
}

/* Переход между вкладками: сдвиг в сторону выбранной */
.res-fwd-enter-active,
.res-fwd-leave-active,
.res-back-enter-active,
.res-back-leave-active {
	transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.res-fwd-enter-from,
.res-back-leave-to {
	opacity: 0;
	transform: translateX(18px);
}
.res-fwd-leave-to,
.res-back-enter-from {
	opacity: 0;
	transform: translateX(-18px);
}

/* Нижнее меню (телефон) */
.tabbar {
	display: none;
}
.tab-badge {
	position: absolute;
	top: -5px;
	right: -9px;
	min-width: 17px;
	height: 17px;
	padding: 0 4px;
	border-radius: var(--radius-max);
	background: var(--color-red);
	color: #fff;
	font-size: 10px;
	font-weight: 700;
	display: grid;
	place-items: center;
	line-height: 1;
	border: 2px solid var(--color-raised-bg);
	animation: pop 420ms cubic-bezier(0.3, 1.6, 0.5, 1);
}
@keyframes pop {
	from {
		transform: scale(0.3);
	}
}

@media (max-width: 720px) {
	.res-nav {
		display: none;
	}
	.res-main {
		padding: var(--gap-lg) var(--gap-md) calc(var(--gap-lg) + 5.2rem + env(safe-area-inset-bottom));
	}
	.tabbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: flex;
		padding: 6px 6px calc(6px + env(safe-area-inset-bottom));
		background: color-mix(in srgb, var(--color-raised-bg) 88%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-top: 1px solid var(--color-divider);
	}
	.tabbar__thumb {
		position: absolute;
		top: 6px;
		height: 3.3rem;
		left: 0;
		border-radius: var(--radius-lg);
		background: var(--color-brand-highlight);
		transition: transform 320ms cubic-bezier(0.3, 0.7, 0.2, 1), width 320ms cubic-bezier(0.3, 0.7, 0.2, 1);
	}
	.tab {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		height: 3.3rem;
		color: var(--color-secondary);
		font-size: 11px;
		font-weight: var(--font-weight-bold);
		-webkit-tap-highlight-color: transparent;
		transition: color var(--speed);
	}
	.tab-ico {
		position: relative;
		display: grid;
		place-items: center;
		transition: transform 220ms cubic-bezier(0.3, 1.6, 0.5, 1);
	}
	.tab.on {
		color: var(--color-brand);
	}
	.tab.on .tab-ico {
		transform: translateY(-1px) scale(1.08);
	}
	.tab:active .tab-ico {
		transform: scale(0.88);
	}
}
</style>
