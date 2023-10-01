ARG BUILDPLATFORM

FROM --platform=${BUILDPLATFORM:-linux/amd64} node:alpine

RUN mkdir -p /app /app_dependencies
RUN apk add --update rsync bash iproute2 curl

WORKDIR /app_dependencies/
COPY package*.json /app_dependencies/
RUN npm install
RUN ln -s -f /app_dependencies/node_modules /app/node_modules

WORKDIR /app
COPY . /app

RUN npm run build && printf "#!/usr/bin/env node\n" > /usr/bin/twine && cat dist/twine.js >> /usr/bin/twine && chmod u+x /usr/bin/twine

CMD twine start