FROM node:18-alpine as build-stage

RUN npm install -g pnpm
RUN mkdir -p /app
WORKDIR /app
COPY . /app/.
RUN pnpm i && pnpm run build

FROM node:18-alpine 
RUN apk add iptables iproute2
COPY --from=build-stage /app/dist/ /app/
CMD node /app/dist/app.js
