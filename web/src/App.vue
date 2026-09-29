<script setup>
import { ref, onMounted, onUnmounted } from "vue"
import { useAuthStore } from "@/stores/auth"
import ToastHost from "@/ui/ToastHost.vue"
import ConfirmHost from "@/ui/ConfirmHost.vue"
import { connectRealtime, disconnectRealtime } from "@/realtime"
import { toast } from "@/toast"

const auth = useAuthStore()

// На вахте связь бывает рваной: честно говорим, что сохранить сейчас не получится
const offline = ref(!navigator.onLine)
const setOnline = () => (offline.value = false)
const setOffline = () => (offline.value = true)

// Сервер обновился, а вкладка открыта со старым интерфейсом — предлагаем перезагрузить.
// Версию сверяем при каждом переподключении живых обновлений (после перезапуска оно обязательно).
let loadedVersion = null
const serverVersion = () =>
	fetch("/api/health")
		.then((r) => r.json())
		.then((r) => r.version)
		.catch(() => null)
async function onReconnected() {
	const v = await serverVersion()
	if (v && loadedVersion && v !== loadedVersion && v !== "dev") {
		loadedVersion = v
		toast.action("Вышла новая версия Хиагды", "Обновить страницу", () => location.reload(), "info")
	}
}

function onUnauthorized() {
	auth.logout()
}
onMounted(() => {
	window.addEventListener("noch:unauthorized", onUnauthorized)
	window.addEventListener("noch:reconnected", onReconnected)
	serverVersion().then((v) => (loadedVersion = v))
	window.addEventListener("online", setOnline)
	window.addEventListener("offline", setOffline)
	if (auth.isAuthed) connectRealtime()
})
onUnmounted(() => {
	window.removeEventListener("noch:unauthorized", onUnauthorized)
	window.removeEventListener("noch:reconnected", onReconnected)
	window.removeEventListener("online", setOnline)
	window.removeEventListener("offline", setOffline)
	disconnectRealtime()
})
</script>

<template>
	<router-view />
	<ToastHost />
	<ConfirmHost />
	<Transition name="offline">
		<div v-if="offline" class="offline" role="status">Нет подключения к интернету — изменения не сохранятся, пока связь не вернётся</div>
	</Transition>
</template>

<style>
.offline {
	position: fixed;
	left: 50%;
	bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
	transform: translateX(-50%);
	z-index: var(--z-toast);
	max-width: calc(100vw - 32px);
	padding: 8px 16px;
	border-radius: 999px;
	background: var(--color-orange);
	color: #1a1205;
	font-size: var(--font-size-sm);
	font-weight: 700;
	text-align: center;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.offline-enter-active,
.offline-leave-active {
	transition: opacity 200ms, transform 200ms;
}
.offline-enter-from,
.offline-leave-to {
	opacity: 0;
	transform: translate(-50%, 8px);
}
</style>
