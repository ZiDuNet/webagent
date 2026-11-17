#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "用法: $0 [build|up|down|logs|ps]" >&2
  echo "  build  只构建单镜像 webagent-pi:local（后端 + admin + chat）" >&2
  echo "  up     构建并启动（默认，等价 docker compose up -d --build）" >&2
  echo "  down   停止并移除容器" >&2
  echo "  logs   查看日志（默认 app）" >&2
  echo "  ps     查看容器状态" >&2
  exit 1
}

if [ ! -f .env ]; then
  echo "缺少 .env，请先执行：npm run init:env" >&2
  exit 1
fi

for key in WEBAGENT_SECRET_KEY WEBAGENT_CONTROL_PASSWORD; do
  if ! grep -qE "^${key}=[[:space:]]*[^[:space:]]" .env; then
    echo ".env 缺少必填变量 ${key}" >&2
    echo "请运行 npm run init:env，并填写独立管理密码 WEBAGENT_CONTROL_PASSWORD" >&2
    exit 1
  fi
done

ACTION="${1:-up}"
case "$ACTION" in
  build) docker compose build ;;
  up) docker compose up -d --build ;;
  down) docker compose down ;;
  logs) docker compose logs -f --tail=200 "${2:-app}" ;;
  ps) docker compose ps ;;
  *) usage ;;
esac
