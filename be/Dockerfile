FROM node:20-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
# Install ALL deps (incl. tsx + drizzle-kit) so the server runs via tsx
# and db:migrate / db:seed can run on deploy. NODE_ENV is set after install
# so npm ci doesn't skip devDependencies.
RUN npm ci --include=dev
ENV NODE_ENV=production
COPY drizzle.config.ts tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
