FROM node:alpine

RUN mkdir -p /app && apk add --update iptables bash openssl wget && wget https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox -O /busybox && chmod +x /busybox
WORKDIR /app

COPY package*.json /app/
RUN npm install 

COPY . /app 
RUN npm run build && printf "#!/usr/bin/env node\n" > /usr/bin/twine && cat dist/twine.js >> /usr/bin/twine && chmod u+x /usr/bin/twine

CMD twine start