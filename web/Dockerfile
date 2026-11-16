# NFL Analytics web: builds the React app, then serves it with Caddy and proxies /api
# to the API container. Same pattern as WePlan's web container.
FROM node:22.23.4-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2.11.7-alpine
# The stock binary carries file capability cap_net_bind_service (for ports <1024). Under
# cap_drop: ALL + no-new-privileges the kernel refuses to exec a file with file caps.
# We listen on 8080, so drop it.
RUN setcap -r /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
EXPOSE 8080
