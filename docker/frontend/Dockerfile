# Multi-stage build. Node is build-time only: this stage runs `npm run build` and its output
# (dist/, plain static files) is copied into a plain nginx image for the final stage — no Node
# process ever runs in the resulting container or in any real deployment of this image.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
