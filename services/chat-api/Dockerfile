FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY services/chat-api/package.json services/chat-api/package.json
RUN npm ci --workspace @agent-team/chat-api --include-workspace-root=false

COPY services/chat-api services/chat-api
RUN npm run build --workspace @agent-team/chat-api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/chat-api/package.json ./services/chat-api/package.json
COPY --from=build /app/services/chat-api/dist ./services/chat-api/dist
COPY --from=build /app/services/chat-api/migrations ./services/chat-api/migrations

USER node
CMD ["node", "services/chat-api/dist/server.js"]
