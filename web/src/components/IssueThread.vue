<script setup>
import { ref, onMounted, watch } from "vue"
import { api, post } from "@/api/client"
import { toast } from "@/toast"
import Icon from "@/components/Icon.vue"

const props = defineProps({ issueId: { type: [Number, String], required: true } })
const comments = ref([])
const text = ref("")
const busy = ref(false)

async function load() {
	try {
		comments.value = await api(`/issues/${props.issueId}/comments`)
	} catch (e) {
		toast(e.message)
	}
}
onMounted(load)
watch(() => props.issueId, load)

async function send() {
	if (!text.value.trim()) return
	busy.value = true
	try {
		await post(`/issues/${props.issueId}/comments`, { text: text.value.trim() })
		text.value = ""
		await load()
	} catch (e) {
		toast(e.message)
	} finally {
		busy.value = false
	}
}
const isStaff = (r) => r === "admin" || r === "editor"
function fmt(d) {
	return d ? new Date(d.replace(" ", "T") + "Z").toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : ""
}
</script>

<template>
	<div>
		<div class="thread">
			<div v-if="!comments.length" class="muted" style="font-size: var(--font-size-sm); text-align: center; padding: var(--gap-md)">
				Сообщений пока нет. Напишите первое.
			</div>
			<div v-for="c in comments" :key="c.id" class="msg" :class="{ staff: isStaff(c.author_role) }">
				<div class="msg-head">
					<b>{{ c.author || "Пользователь" }}</b>
					<span v-if="isStaff(c.author_role)" class="tag">персонал</span>
					<span class="muted">{{ fmt(c.created_at) }}</span>
				</div>
				<div style="white-space: pre-wrap">{{ c.text }}</div>
			</div>
		</div>
		<div class="row" style="gap: var(--gap-sm); margin-top: var(--gap-sm)">
			<input v-model="text" placeholder="Написать сообщение…" @keyup.enter="send" />
			<button class="btn btn-brand" :disabled="busy" @click="send"><Icon name="message-square" /></button>
		</div>
	</div>
</template>

<style scoped>
.thread {
	display: grid;
	gap: var(--gap-sm);
	max-height: 340px;
	overflow: auto;
	padding: var(--gap-xs);
}
.msg {
	padding: var(--gap-sm) var(--gap-md);
	border-radius: var(--radius-md);
	background: var(--color-bg);
	border: 1px solid var(--color-divider);
	font-size: var(--font-size-sm);
}
.msg.staff {
	background: var(--color-brand-highlight);
	border-color: transparent;
}
.msg-head {
	display: flex;
	align-items: center;
	gap: var(--gap-sm);
	margin-bottom: 2px;
	font-size: var(--font-size-xs);
}
.msg-head b {
	color: var(--color-contrast);
}
.tag {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	color: var(--color-brand);
	border: 1px solid var(--color-brand);
	border-radius: var(--radius-max);
	padding: 0 6px;
}
</style>
