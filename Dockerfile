FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY sdk/package.json sdk/package.json
COPY admin/package.json admin/package.json
COPY chat/package.json chat/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
ARG VITE_CHAT_URL=/chat/
ARG VITE_ADMIN_URL=/admin/
ARG VITE_BUSINESS_URL=
ENV VITE_CHAT_URL=$VITE_CHAT_URL VITE_ADMIN_URL=$VITE_ADMIN_URL VITE_BUSINESS_URL=$VITE_BUSINESS_URL
COPY server/ server/
COPY sdk/ sdk/
COPY admin/ admin/
COPY chat/ chat/
COPY scripts/ scripts/
RUN npm run typecheck && npm test && npm run build

FROM node:24-bookworm-slim AS backend
ENV NODE_ENV=production \
    HOME=/tmp \
    WEBAGENT_BIND_HOST=0.0.0.0 \
    WEBAGENT_PORT=8000 \
    WEBAGENT_DATA_DIR=/app/data
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist/ server/dist/
COPY --from=build /app/sdk/package.json sdk/package.json
COPY --from=build /app/sdk/dist/ sdk/dist/
COPY --from=build /app/admin/dist/ admin/dist/
COPY --from=build /app/chat/dist/ chat/dist/
COPY scripts/upgrade-pi.mjs scripts/upgrade-pi.mjs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS admin
COPY deploy/admin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist/ /usr/share/nginx/html/admin/
EXPOSE 8080

FROM nginxinc/nginx-unprivileged:1.28-alpine AS chat
COPY deploy/chat.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/chat/dist/ /usr/share/nginx/html/chat/
EXPOSE 8080
