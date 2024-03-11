FROM node:20-alpine as build-stage

RUN apk add git
RUN npm install -g pnpm
RUN mkdir -p /app
WORKDIR /app
COPY . /app/.
RUN pnpm i && pnpm run build

FROM node:20-alpine 
COPY --from=build-stage /app/dist/ /app/
CMD node /app/dist/app.js
