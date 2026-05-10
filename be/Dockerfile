FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Install ALL deps (incl. tsx + drizzle-kit) so the server runs via tsx
# and db:migrate / db:seed can run on deploy.
RUN npm ci
COPY drizzle.config.ts tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
