#!/bin/bash
set -e

# ============================================================
# workTeam 一键部署脚本
# 用法: SERVER_IP=<你的服务器IP> ./deploy.sh
# ============================================================

if [ -z "$SERVER_IP" ]; then
  echo "用法: SERVER_IP=<服务器IP> $0"
  echo "示例: SERVER_IP=39.107.55.154 $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENIM_DIR="${SCRIPT_DIR}/opt/openim-docker"

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

if ! docker compose ps 2>/dev/null | grep -q "openim-server"; then
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
OPENIM_ADMIN_TOKEN=openIM123
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

if [ ! -f .env.gateway.local ]; then
  GATEWAY_SECRET=$(openssl rand -base64 32)
  cat > .env.gateway.local <<EOF
AGENT_GATEWAY_PORT=8787
AGENT_GATEWAY_SECRET=${GATEWAY_SECRET}
OPENIM_API_ADDR=http://openim-server:10002
OPENIM_ADMIN_TOKEN=openIM123
AGENT_IDS=agent_coordinator,agent_architect,agent_coder,agent_reviewer
OPENIM_GROUP_IDS=
EOF
  echo "  .env.gateway.local 已创建"
else
  echo "  .env.gateway.local 已存在，保留现有配置"
fi

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

  回调 Token: ${CALLBACK_TOKEN}

  下一步:
    1. 在桌面端设置中填写后台地址 http://${SERVER_IP}:8790
    2. 注册账号后即可使用

SUMMARY