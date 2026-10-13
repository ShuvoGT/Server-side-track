# Dashboard image. Build from the repository root:
#   docker build -f apps/dashboard/Dockerfile -t sst-dashboard .

FROM node:24-alpine AS build
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/gateway/package.json apps/gateway/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/provisioner/package.json apps/provisioner/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/dashboard apps/dashboard
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
RUN pnpm --filter @sst/shared build && pnpm --filter @sst/dashboard build

FROM node:24-alpine
RUN apk add --no-cache tini
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3100
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/dashboard/server.js"]
