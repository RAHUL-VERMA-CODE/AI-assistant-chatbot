FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY tools/demo-tenant/ ./tools/demo-tenant/
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @vca/demo-tenant build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=development
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/tools/demo-tenant/dist ./tools/demo-tenant/dist
COPY --from=builder /app/tools/demo-tenant/package.json ./tools/demo-tenant/package.json
USER appuser
EXPOSE 4000
CMD ["node", "tools/demo-tenant/dist/index.js"]
