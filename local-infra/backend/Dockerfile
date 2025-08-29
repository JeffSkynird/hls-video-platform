FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
# Ensure OpenSSL 3 is available and tell Prisma to target it
RUN apk add --no-cache openssl
ENV PRISMA_ENGINE_OPENSSL_VERSION=3.0.x
RUN npx prisma generate

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Ensure Prisma picks the OpenSSL 3 engine at runtime
ENV PRISMA_ENGINE_OPENSSL_VERSION=3.0.x
# OpenSSL is required at runtime for Prisma engine
RUN apk add --no-cache openssl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main.js"]
