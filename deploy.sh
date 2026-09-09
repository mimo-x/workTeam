#!/bin/bash
set -e

# ============================================================
# workTeam 一键部署脚本
# 用法: ./deploy.sh
# ============================================================

SERVER_IP="${SERVER_IP:-$(curl -4 -fsS --connect-timeout 3 --max-time 8 https://api.ipify.org || true)}"
if [ -z "$SERVER_IP" ]; then
  echo "错误: 无法自动获取服务器公网 IP，请设置 SERVER_IP 后重试。"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENIM_DIR="${SCRIPT_DIR}/opt/openim-docker"
OPENIM_API_PORT="10002"

echo "=========================================="
echo "  workTeam 一键部署"
echo "  服务器 IP: ${SERVER_IP}"
echo "=========================================="

# 1. 部署 OpenIM
echo ""
echo ">>> 1/5 部署 OpenIM ..."

if [ ! -d "$OPENIM_DIR" ]; then
  mkdir -p "$(dirname "$OPENIM_DIR")"
  git clone https://github.com/openimsdk/openim-docker.git "$OPENIM_DIR"
  cd "$OPENIM_DIR"
  git checkout v3.8
else
  cd "$OPENIM_DIR"
fi

if [ -f "$OPENIM_DIR/.env" ]; then
  OPENIM_API_PORT="$(awk -F= '$1 == "OPENIM_API_PORT" {value=$2; sub(/[[:space:]]*#.*/, "", value); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value}' "$OPENIM_DIR/.env" | tail -n 1)"
  OPENIM_API_PORT="${OPENIM_API_PORT:-10002}"
  OPENIM_SECRET="$(awk -F= '$1 == "OPENIM_SECRET" {value=$2; sub(/[[:space:]]*#.*/, "", value); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value}' "$OPENIM_DIR/.env" | tail -n 1)"
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "openim-server"; then
  sed -i "s|external_ip|${SERVER_IP}|g" .env
  docker compose up -d

  echo "  等待 OpenIM 就绪..."
  for i in $(seq 1 60); do
    if docker compose ps 2>/dev/null | grep -q "openim-server.*healthy"; then break; fi
    sleep 3
  done
  echo "  OpenIM 就绪"
else
  echo "  OpenIM 已运行，跳过"
fi

echo "  获取 OpenIM 管理凭证..."
if [ -z "${OPENIM_SECRET:-}" ]; then
  echo "  错误: 未找到 OpenIM_SECRET，无法自动获取管理员 Token。"
  exit 1
fi
read_env_value() {
  local file="$1" key="$2"
  if [ -f "$file" ]; then
    awk -F= -v wanted="$key" '$1 == wanted {value=$2; sub(/[[:space:]]*#.*/, "", value); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value}' "$file" | tail -n 1
  fi
}

OPENIM_ADMIN_TOKEN="$(read_env_value "$SCRIPT_DIR/.env.backend.local" OPENIM_ADMIN_TOKEN)"
if [ -n "$OPENIM_ADMIN_TOKEN" ] && [ "$OPENIM_ADMIN_TOKEN" != "openIM123" ] && [ "$OPENIM_ADMIN_TOKEN" != "replace-with-openim-admin-token" ]; then
  if ! curl -fsS --connect-timeout 2 --max-time 5 \
    -H 'content-type: application/json' \
    -H "operationID: workteam-deploy-existing" \
    -H "token: ${OPENIM_ADMIN_TOKEN}" \
    -d '{"userID":"imAdmin","platformID":4}' \
    "http://127.0.0.1:${OPENIM_API_PORT}/auth/get_user_token" \
    | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if not value.get("errCode") and (value.get("data") or {}).get("token") else 1)'; then
    OPENIM_ADMIN_TOKEN=""
  else
    echo "  已复用现有 OpenIM 管理凭证"
  fi
fi
for i in $(seq 1 30); do
  if OPENIM_ADMIN_TOKEN="$({
    curl -fsS --connect-timeout 2 --max-time 5 \
      -H 'content-type: application/json' \
      -H "operationID: workteam-deploy-${i}" \
      -d "{\"userID\":\"imAdmin\",\"secret\":\"${OPENIM_SECRET}\"}" \
      "http://127.0.0.1:${OPENIM_API_PORT}/auth/get_admin_token" || true
  } | python3 -c 'import json,sys
try:
 value=json.load(sys.stdin); data=value.get("data") or {}; token=data.get("token", ""); print(token if token and not value.get("errCode") else "")
except Exception:
 print("")')"; then
    if [ -n "$OPENIM_ADMIN_TOKEN" ]; then break; fi
  fi
  sleep 2
done
if [ -z "$OPENIM_ADMIN_TOKEN" ]; then
  echo "  错误: 无法获取 OpenIM 管理 Token，请检查 OpenIM 服务状态和 OPENIM_SECRET。"
  exit 1
fi
echo "  OpenIM 管理凭证已就绪"

# 2. 创建 .env 文件
echo ""
echo ">>> 2/5 创建配置文件 ..."

cd "$SCRIPT_DIR"

if [ ! -f .env.backend.local ]; then
  JWT_SECRET=$(openssl rand -base64 32)
  ENCRYPTION_KEY=$(openssl rand -base64 32)
  CALLBACK_TOKEN=$(openssl rand -base64 32)

  cat > .env.backend.local <<EOF
NODE_ENV=development
HOST=0.0.0.0
PORT=8790
DATABASE_URL=postgres://agent_team:agent_team@postgres:5432/agent_team
REDIS_URL=redis://redis:6379
JWT_SECRET=${JWT_SECRET}
KEY_PROVIDER=local
ENCRYPTION_MASTER_KEY=${ENCRYPTION_KEY}
CORS_ORIGIN=*
PUBLIC_API_URL=http://${SERVER_IP}:8790
OPENIM_API_URL=http://openim-server:10002
OPENIM_WS_URL=ws://${SERVER_IP}:10001
OPENIM_ADMIN_TOKEN=${OPENIM_ADMIN_TOKEN}
OPENIM_CALLBACK_TOKEN=${CALLBACK_TOKEN}
OPENIM_PLATFORM_ID=4
HOST_LEASE_SECONDS=30
HOST_HEARTBEAT_SECONDS=10
EOF
  echo "  .env.backend.local 已创建"
else
  echo "  .env.backend.local 已存在，保留现有配置"
  CALLBACK_TOKEN=$(grep '^OPENIM_CALLBACK_TOKEN=' .env.backend.local | cut -d '=' -f2-)
fi

set_env_value() {
  local file="$1" key="$2" value="$3"
  VALUE="$value" python3 - "$file" "$key" <<'PY'
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = os.environ["VALUE"]
lines = path.read_text().splitlines() if path.exists() else []
updated = False
result = []
for line in lines:
    if line.startswith(f"{key}="):
        result.append(f"{key}={value}")
        updated = True
    else:
        result.append(line)
if not updated:
    result.append(f"{key}={value}")
path.write_text("\n".join(result) + "\n")
path.chmod(0o600)
PY
}

backup_file() {
  local file="$1"
  if [ -f "$file" ]; then
    cp "$file" "${file}.bak.$(date +%Y%m%d%H%M%S)"
    chmod 600 "${file}.bak."*
  fi
}

backup_file "$SCRIPT_DIR/.env.backend.local"
set_env_value "$SCRIPT_DIR/.env.backend.local" OPENIM_ADMIN_TOKEN "$OPENIM_ADMIN_TOKEN"

if [ ! -f .env.gateway.local ]; then
  GATEWAY_SECRET=$(openssl rand -base64 32)
  cat > .env.gateway.local <<EOF
AGENT_GATEWAY_PORT=8787
AGENT_GATEWAY_SECRET=${GATEWAY_SECRET}
OPENIM_API_ADDR=http://openim-server:10002
OPENIM_ADMIN_TOKEN=${OPENIM_ADMIN_TOKEN}
AGENT_IDS=agent_coordinator,agent_architect,agent_coder,agent_reviewer
OPENIM_GROUP_IDS=
EOF
  echo "  .env.gateway.local 已创建"
else
  echo "  .env.gateway.local 已存在，保留现有配置"
fi
backup_file "$SCRIPT_DIR/.env.gateway.local"
set_env_value "$SCRIPT_DIR/.env.gateway.local" OPENIM_ADMIN_TOKEN "$OPENIM_ADMIN_TOKEN"

# 3. 启动后台
echo ""
echo ">>> 3/5 启动业务后台 ..."

docker compose -f deploy/docker-compose.yml up -d --build

echo "  等待后台就绪..."
READY=false
for i in $(seq 1 30); do
  if curl -sf http://localhost:8790/health/live > /dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 2
done

if [ "$READY" = false ]; then
  echo "  错误: 业务后台启动超时！请检查容器日志: docker compose -f deploy/docker-compose.yml logs api"
  exit 1
fi
echo "  后台就绪"

echo "  检查后台就绪状态..."
if ! curl -fsS --connect-timeout 3 --max-time 10 http://localhost:8790/health/ready \
  | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if value.get("ok") is True and value.get("openimConfigured") is True else 1)'; then
  echo "  错误: 后台未通过就绪检查，请检查 API 和 OpenIM 配置。"
  exit 1
fi
echo "  后台就绪检查通过"

echo "  验证 OpenIM 会话链路..."
if ! curl -fsS --connect-timeout 3 --max-time 10 \
  -H 'content-type: application/json' \
  -H "operationID: workteam-deploy-health" \
  -H "token: ${OPENIM_ADMIN_TOKEN}" \
  -d '{"userID":"imAdmin","platformID":4}' \
  "http://127.0.0.1:${OPENIM_API_PORT}/auth/get_user_token" \
  | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if not value.get("errCode") and (value.get("data") or {}).get("token") else 1)'; then
  echo "  错误: OpenIM 管理 Token 校验失败，部署未完成。"
  exit 1
fi
echo "  OpenIM 会话链路正常"

# 4. 网络互通
echo ""
echo ">>> 4/5 配置网络互通 ..."

OPENIM_NET=$(docker network ls --format '{{.Name}}' | grep openim || true)
if [ -n "$OPENIM_NET" ]; then
  for svc in agent-team-backend-api-1 agent-team-backend-outbox-worker-1 agent-team-backend-gateway-1 deploy-api-1 deploy-outbox-worker-1 deploy-gateway-1; do
    docker network connect "$OPENIM_NET" "$svc" 2>/dev/null || true
  done
  echo "  网络已连接"
fi

echo "  检查 Agent Gateway..."
if ! curl -fsS --connect-timeout 3 --max-time 10 http://localhost:8787/health \
  | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if value.get("ok") is True and value.get("openImConfigured") is True else 1)'; then
  echo "  错误: Agent Gateway 未通过就绪检查。"
  exit 1
fi
echo "  Agent Gateway 就绪"

# 5. 配置回调
echo ""
echo ">>> 5/5 配置 OpenIM 回调 ..."

docker cp openim-server:/openim-server/config/webhooks.yml "$OPENIM_DIR/webhooks.yml" 2>/dev/null || true
cd "$OPENIM_DIR"

python3 -c "
import re
with open('webhooks.yml', 'r') as f:
    content = f.read()
callback_token = '${CALLBACK_TOKEN}'
before_url = f'http://api:8790/internal/openim/callbacks/message/before?token={callback_token}'
after_url = f'http://api:8790/internal/openim/callbacks/message/after?token={callback_token}'

content = re.sub(
    r'beforeSendGroupMsg:\s*\n\s*enable:\s*(?:true|false)\s*\n\s*url:[^\n]*',
    f'beforeSendGroupMsg:\n  enable: true\n  url: \"{before_url}\"',
    content
)
content = re.sub(
    r'afterSendGroupMsg:\s*\n\s*enable:\s*(?:true|false)\s*\n\s*url:[^\n]*',
    f'afterSendGroupMsg:\n  enable: true\n  url: \"{after_url}\"',
    content
)
with open('webhooks.yml', 'w') as f:
    f.write(content)
"
docker cp webhooks.yml openim-server:/openim-server/config/webhooks.yml
docker compose restart openim-server 2>/dev/null || true
echo "  回调已配置"

cat <<SUMMARY

==========================================
  部署完成！
==========================================

  服务地址:
    业务后台:     http://${SERVER_IP}:8790
    OpenIM 管理:  http://${SERVER_IP}:11002
    Agent Gateway: http://${SERVER_IP}:8787

  管理后台登录:
    用户名: chatAdmin
    密码:   chatAdmin

  下一步:
    1. 在桌面端设置中填写后台地址 http://${SERVER_IP}:8790
    2. 注册账号后即可使用

SUMMARY
