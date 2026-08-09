# 프로덕션 배포용 이미지. 로컬 개발은 docker-compose(DB/Redis) + pnpm api:dev 사용.
FROM node:20-alpine AS base

WORKDIR /app

RUN npm install -g pnpm@9

FROM base AS builder

COPY package.json pnpm-workspace.yaml turbo.json ./
COPY pnpm-lock.yaml* ./
COPY packages/types/package.json ./packages/types/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --no-frozen-lockfile

COPY packages ./packages
RUN pnpm --filter @money/api exec prisma generate
RUN pnpm run build --filter=@money/api

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=builder /app ./

EXPOSE 3001

CMD ["node", "packages/api/dist/main.js"]
