<script setup>
import { onMounted, onUnmounted } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { toasts } from "@/toast"

const router = useRouter()
const auth = useAuthStore()

function onUnauthorized() {
	auth.logout()
	router.push({ name: "login" })
}
onMounted(() => {
	const theme = localStorage.getItem("noch_theme") || "dark"
	document.documentElement.setAttribute("data-theme", theme)
	window.addEventListener("noch:unauthorized", onUnauthorized)
})
onUnmounted(() => window.removeEventListener("noch:unauthorized", onUnauthorized))
</script>

<template>
	<router-view />
	<div class="toasts">
		<div v-for="t in toasts" :key="t.id" class="toast">{{ t.message }}</div>
	</div>
</template>
