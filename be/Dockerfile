FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Install ALL deps (incl. drizzle-kit + tsx) so db:migrate / db:seed can run on deploy
RUN npm ci
COPY --from=build /app/dist ./dist
COPY drizzle.config.ts tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["node", "dist/server.js"]
