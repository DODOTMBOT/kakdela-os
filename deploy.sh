#!/usr/bin/env bash
# Выкладка новой версии на сервер: сборка → загрузка кода → перезапуск сервиса.
# Данные (/var/lib/kakdela) и секреты (/opt/kakdela/.env.production) не трогает.
set -euo pipefail
cd "$(dirname "$0")"

SERVER=root@186.246.9.147
SSH="ssh -i $HOME/.ssh/kakdela_deploy -o IdentitiesOnly=yes"

npx vite build
rsync -az --delete -e "$SSH" --exclude 'data/' dist server package.json "$SERVER:/opt/kakdela/"
$SSH "$SERVER" 'chown -R kakdela:kakdela /opt/kakdela && systemctl restart kakdela && sleep 2 && systemctl is-active kakdela'
curl -s -o /dev/null -w "https://kbkdk.ru → %{http_code}\n" https://kbkdk.ru/
