# Image for the Node services in the monorepo (the dashboard has its own: apps/dashboard/Dockerfile):
#   docker build --build-arg APP=gateway -t sst-gateway .
#   docker build --build-arg APP=api -t sst-api .
#   docker build --build-arg APP=provisioner -t sst-provisioner .

FROM node:24-alpine AS build
RUN npm install -g pnpm@9.15.9 && apk add --no-cache openssl
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/gateway/package.json apps/gateway/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/provisioner/package.json apps/provisioner/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/api apps/api
COPY apps/gateway apps/gateway
COPY apps/provisioner apps/provisioner
ARG APP
# Build the app and the workspace packages it depends on.
RUN pnpm --filter "@sst/${APP}..." build
RUN pnpm --filter "@sst/${APP}" deploy --prod /out \
 && if [ "$APP" = "api" ]; then cd /out && ./node_modules/.bin/prisma generate && mkdir -p data; fi

FROM node:24-alpine
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
