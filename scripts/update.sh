#!/usr/bin/env bash
# Автообновление «Хиагды» из git-репозитория (сервер на Linux, запуск через Docker Compose).
#
#   sudo bash scripts/update.sh             проверить репозиторий и обновиться, если есть новое
#   sudo bash scripts/update.sh --force     пересобрать и перезапустить, даже если нового нет
#   sudo bash scripts/update.sh --install   поставить systemd-таймер (проверка каждые 15 минут)
#                                          и кнопку «Проверить сейчас» в админке
#   sudo bash scripts/update.sh --uninstall убрать таймер
#
# Что происходит при обновлении:
#   1. git fetch — есть ли новые коммиты в ветке UPDATE_BRANCH (по умолчанию main);
#   2. резервная копия базы и файлов (не снялась — обновление отменяется);
#   3. сборка нового образа — старая версия в это время продолжает работать;
#   4. перезапуск (перерыв ~10–20 секунд, открытые страницы переподключатся сами);
#   5. проверка /api/health: новая версия должна ответить за 2 минуты.
#      Не ответила — возвращаем прежний образ и прежний код, пишем причину.
# Итог каждой попытки — в data/update-status.json, его видно в админке («Резервные копии»).
#
# Настройки в .env: UPDATE_BRANCH=main, UPDATE_EVERY=15min (для --install), PORT=3000.
set -euo pipefail
# Скрипт обновляет и сам себя (git), а bash читает файл по ходу выполнения —
# поэтому работаем с копией во временном файле
if [ -z "${HIAGDA_DIR:-}" ]; then
	HIAGDA_DIR=$(cd "$(dirname "$0")/.." && pwd)
	export HIAGDA_DIR
	copy=$(mktemp)
	cp "$0" "$copy"
	exec bash "$copy" "$@"
fi
cd "$HIAGDA_DIR"
DIR=$HIAGDA_DIR

# Значение из .env без исполнения файла: там пароли и произвольные символы
env_val() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d "\"'\r" || true; }
BRANCH=$(env_val UPDATE_BRANCH); BRANCH=${BRANCH:-main}
PORT=$(env_val PORT); PORT=${PORT:-3000}
EVERY=$(env_val UPDATE_EVERY); EVERY=${EVERY:-15min}
IMAGE=$(env_val APP_IMAGE); IMAGE=${IMAGE:-hiagda-app}
HEALTH=$(env_val HEALTH_URL); HEALTH=${HEALTH:-http://127.0.0.1:$PORT/api/health}
STATUS=data/update-status.json

log() { echo "[$(date '+%F %T')] $*"; }

if [ "${1:-}" = "--install" ]; then
	cat >/etc/systemd/system/hiagda-update.service <<UNIT
[Unit]
Description=Хиагда: проверка и установка обновлений
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=/bin/bash $DIR/scripts/update.sh
UNIT
	cat >/etc/systemd/system/hiagda-update.timer <<UNIT
[Unit]
Description=Хиагда: автообновление каждые $EVERY

[Timer]
OnBootSec=5min
OnUnitActiveSec=$EVERY
RandomizedDelaySec=60
Persistent=true

[Install]
WantedBy=timers.target
UNIT
	# Кнопка в админке пишет data/update-request — systemd замечает и запускает проверку.
	# Приложению не нужен доступ к Docker или root: только право создать файл в своём data/.
	cat >/etc/systemd/system/hiagda-update.path <<UNIT
[Unit]
Description=Хиагда: проверка обновлений по кнопке из админки

[Path]
PathModified=$DIR/data/update-request
Unit=hiagda-update.service

[Install]
WantedBy=multi-user.target
UNIT
	systemctl daemon-reload
	systemctl enable --now hiagda-update.timer hiagda-update.path
	log "Таймер включён: проверка каждые $EVERY, ветка $BRANCH. Журнал: journalctl -u hiagda-update"
	exit 0
fi
if [ "${1:-}" = "--uninstall" ]; then
	systemctl disable --now hiagda-update.timer hiagda-update.path 2>/dev/null || true
	rm -f /etc/systemd/system/hiagda-update.service /etc/systemd/system/hiagda-update.timer /etc/systemd/system/hiagda-update.path
	systemctl daemon-reload
	log "Таймер автообновления убран"
	exit 0
fi
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Один запуск за раз: таймер и ручной вызов не должны столкнуться
exec 9>/tmp/hiagda-update.lock
flock -n 9 || { log "Обновление уже идёт — выхожу"; exit 0; }

FROM=$(git rev-parse HEAD)
TO=$FROM
CHANGES="[]"
# Заголовки новых коммитов — «что нового» в админке (JSON-массив строк)
changes_json() {
	local out="" line
	while IFS= read -r line; do
		line=${line//\\/\\\\}
		line=${line//\"/\\\"}
		line=${line//$'\t'/ }
		out+="${out:+,}\"$line\""
	done < <(git log --no-merges --format=%s "$FROM..$TO" | head -30)
	echo "[$out]"
}
status() {
	mkdir -p data
	local msg=${2//\\/\/}
	msg=${msg//\"/\'}
	printf '{"at":"%s","result":"%s","branch":"%s","from":"%s","to":"%s","message":"%s","changes":%s}\n' \
		"$(date -u +%FT%TZ)" "$1" "$BRANCH" "${FROM:0:7}" "${TO:0:7}" "$msg" "$CHANGES" >"$STATUS.tmp"
	mv "$STATUS.tmp" "$STATUS"
	log "$1: $2"
}
mkdir -p data && date -u +%FT%TZ >data/update-checked-at

git fetch --quiet origin "$BRANCH" || { status failed "Не удалось получить обновления из репозитория (нет сети или доступа)"; exit 1; }
TO=$(git rev-parse "origin/$BRANCH")
if [ "$FROM" = "$TO" ] && [ $FORCE = 0 ]; then exit 0; fi
CHANGES=$(changes_json)

# Правки прямо на сервере не затираем молча
if ! git diff --quiet || ! git diff --cached --quiet; then
	status failed "На сервере изменены файлы проекта — автообновление пропущено. Посмотрите: git status"
	exit 1
fi
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then git checkout -q "$BRANCH"; fi
if ! git merge-base --is-ancestor "$FROM" "$TO" && [ $FORCE = 0 ]; then
	status failed "История ветки $BRANCH переписана (force push) — обновите вручную: sudo bash scripts/update.sh --force"
	exit 1
fi

log "Обновление ${FROM:0:7} → ${TO:0:7} (ветка $BRANCH)"

# 1. Резервная копия — через работающее приложение, там есть pg_dump нужной версии
if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
	docker compose exec -T -e BACKUP_NOTE="перед обновлением до ${TO:0:7}" app node scripts/backup.js >/dev/null ||
		{ status failed "Резервная копия не снялась — обновление отменено"; exit 1; }
else
	log "Приложение не запущено — копию перед обновлением пропускаю"
fi

# 2. Код и сборка. Прошлый образ запоминаем — откат без пересборки.
docker image inspect "$IMAGE:latest" >/dev/null 2>&1 && docker tag "$IMAGE:latest" "$IMAGE:previous"
git merge -q --ff-only "$TO" 2>/dev/null || git reset -q --hard "$TO"
export APP_VERSION
APP_VERSION=$(git describe --tags --always)
export APP_BUILT_AT
APP_BUILT_AT=$(date -u +%FT%TZ)
BUILD_LOG=data/update-build.log
# Только настоящие сетевые сбои: строки вида «load metadata for docker.io/…» есть в любом логе сборки
NET_ERR='TLS handshake timeout|i/o timeout|no such host|connection refused|failed to do request|network is unreachable|connection reset by peer|failed to resolve source metadata'
build() {
	local i
	for i in 1 2 3; do
		docker compose build app >"$BUILD_LOG" 2>&1 && return 0
		# Ошибка в самом коде — повторять бесполезно
		grep -qiE "$NET_ERR" "$BUILD_LOG" || return 1
		log "Нет связи с Docker Hub (попытка $i из 3) — повторю через 20 с"
		sleep 20
	done
	# Docker Hub так и не ответил. Классический сборщик берёт базовые образы из локального
	# хранилища и в Docker Hub не ходит, если они уже скачаны раньше.
	log "Собираю классическим сборщиком из локальных образов"
	DOCKER_BUILDKIT=0 docker build --force-rm -t "$IMAGE:latest" --build-arg APP_VERSION="$APP_VERSION" \
		--build-arg APP_BUILT_AT="$APP_BUILT_AT" . >>"$BUILD_LOG" 2>&1
}
if ! build; then
	git reset -q --hard "$FROM"
	if grep -qiE "$NET_ERR" "$BUILD_LOG"; then
		status failed "Нет доступа к Docker Hub, а нужных образов нет локально. Осталась ${FROM:0:7}. Настройте зеркало реестра (README, раздел про автообновление)"
	else
		# Первая внятная ошибка и место в коде — без цветовых кодов терминала
		clean=$(sed 's/\x1b\[[0-9;]*m//g' "$BUILD_LOG")
		reason=$(grep -m1 -oE '\[[A-Z_]*ERROR\] ?[^│╭]*|npm ERR! .*|SyntaxError: .*|Error: .*' <<<"$clean" | head -1 | cut -c1-120)
		where=$(grep -m1 -oE '(web|server|scripts)/[A-Za-z0-9_./-]+:[0-9]+(:[0-9]+)?' <<<"$clean" | head -1)
		status failed "Новая версия не собралась — осталась ${FROM:0:7}. ${reason:+Ошибка: $reason}${where:+ ($where)}. Полный лог: data/update-build.log"
	fi
	exit 1
fi

# 3. Перезапуск и проверка
docker compose up -d app
for _ in $(seq 60); do
	if curl -fsS "$HEALTH" 2>/dev/null | grep -q "\"version\":\"$APP_VERSION\""; then
		status ok "Обновлено до $APP_VERSION"
		docker image prune -f >/dev/null 2>&1 || true
		exit 0
	fi
	# Падает при запуске и перезапускается по кругу — не ждём 2 минуты, откатываем сразу:
	# пока ждём, сайт лежит
	restarts=$(docker inspect -f '{{.RestartCount}}' "$(docker compose ps -q app)" 2>/dev/null || echo 0)
	[ "${restarts:-0}" -ge 3 ] && break
	sleep 2
done

# 4. Не поднялась — откат
log "Новая версия не отвечает — откатываю"
crash=$(docker compose logs --no-log-prefix --tail 60 app 2>/dev/null | grep -iE 'error|exception' | tail -1 | cut -c1-160)
git reset -q --hard "$FROM"
if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
	docker tag "$IMAGE:previous" "$IMAGE:latest"
	docker compose up -d --no-build app
fi
status rolled_back "Версия ${TO:0:7} не запустилась — вернул ${FROM:0:7}. ${crash:+Причина: $crash}"
exit 1
