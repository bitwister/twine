# Twine
### Docker Container Network Management with Labels

Current routing/forwarding implementations in Docker rely on `network_mode: service:vpn` method, which merges existing networks into one, creating some limitations, breaking network isolation and making it harder to write/read complex deployment configurations. 

Twine is created to improve this process with a simple label-based (similar to Traefik) approach that makes it easy to configure persitent networking rules and preserves containers full network isolation.

Twine works by modifying container networking like iptables, routes, sysctl via permisson `pid: host` with `nsenter` in network layer of the docker containers. This preserves container network isolation, while keeping the changes in the temporary layer that gets automatically cleaned up in the container lifecycle. Twine automatically resolves the container hostnames and keeps configrations up to date, as the environment changes.


## API Referrence

**WARNING: Twine undergone multiple heavy changes already, and the final syntax of the labels is not solidfied yet. Expect features to change and/or break until a stable release.**

### Container labels

These labels, simillarly to the Traefik, apply networking configuration to the container, if specified in the `labels:` section of docker-compose.

- #### `twine.nat.interfaces=<interface>[,<interface>...]`
  > `twine.nat.interfaces=wg+,eth+`
  
  > `twine.nat.interfaces=+`

  Enable NAT (forwarding) for the specified interfaces ([iptables interface pattern](https://linux.die.net/man/8/iptables)). Multiple interfaces can be specified, wildcards are supported.

- #### `twine.nat.forward.[<interface>].<sourcePort>[/tcp\|udp]=<destination>:<port>`
  > `twine.nat.forward.eth0.25565/tcp=minecraft:25565`

  > `twine.nat.forward.wg+.80=nginx:80`

  > `twine.nat.forward.80=nginx:80`

  Forward incoming connections on `<sourcePort>` to the specified `<destination>` 

- #### `twine.route.<network>=<destination>`
  > `twine.route.192.168.0.1/24=wireguard`

  > `twine.route.0.0.0.0/0=wireguard`

  Create a route to the specified `<network>` that can be reached via `<destination>` (gateway)

- #### `twine.iptables.rule.<name>=<iptablesRule>`
  > `twine.iptables.rule.blockAll=TWINE_INPUT -s 10.250.0.1/24 -d 0.0.0.0 -j DROP`
  
  > `twine.iptables.rule.allowVPN=TWINE_INPUT -s 10.250.0.1/24 -d 10.250.0.1/24 -j ACCEPT`

  Create a custom iptables rule with a `<name>`. 
  
  Note that `<iptablesRule>` must start with one of the avaialble chains:
    - `TWINE_INPUT`
    - `TWINE_OUTPUT`
    - `TWINE_FORWARD`
    - `TWINE_NAT_POSTROUTING`
    - `TWINE_NAT_PREROUTING`
    - `TWINE_NAT_OUTPUT`


- #### `twine.host.routes=<network>[,<network>...]`
  > `twine.host.routes=192.168.100.1/24,10.20.0.0/24`

  > `twine.host.routes=192.168.0.1/24`

  Create a route from a Docker host machine to the container

  TODO: Implemented, but disabled. It is only possible to do on linux. Docker Desktop runtime (Windows/MacOS) is not supported...

<!-- ### `twine.iptables.rule.<name>=<custom ip tables rule>`
TODO
### `twine.nat.whitelist.[<interface>].from=<network>[,<network>...]`
TODO
### `twine.nat.whitelist.[<interface>].to=<network>[,<network>...]`
TODO -->


## Usecase Examples

Every Docker host machine must have at-least one instance of the twine container running. 
Only one instance can run at the time.

```yml
services:
  twine:
    image: ghcr.io/bitwister/twine:latest
    restart: unless-stopped
    # Required access:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    privileged: true
    pid: host
```

### VPN Infrastracture
In this example whole internet traffic of `qbittorrent` container is routed via `wireguard-client` container. 

Additionally port `9080` is forwarded from `wireguard-client`'s ip address to the `qbittorent` container.
```yml
services:
  
  wireguard-client:
    image: lscr.io/linuxserver/wireguard:latest
    networks:
      - main
    # ...
    labels:
      # Interface for forwarding traffic (Required for "twine.route.*=wireguard-client" to work) 
      - twine.nat.interfaces=wg+
      # Expose qbittorrent on WireGuard Client ip address
      - twine.nat.forward.9080=qbittorrent:9080

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    networks:
      - main
    ports:
      - 127.0.0.1:9080:9080
    # ...
    labels:
      # Route all outgoing traffic via WireGuard Client
      - twine.route.0.0.0.0/1=wireguard-client
      - twine.route.128.0.0.0/1=wireguard-client
      # Route only internal subnet via WireGuard Client
      # - twine.route.10.250.0.0/24=wireguard-client

```

### LetsEncrypt Traefik DNS Challenge with locally hosted DNS server dnsmasq 

In this example localhost connections on port `5353` from `dnsmasq` container are forwarded to `traefik`'s container. 

In a normal scenario you cannot provide a hostname to the dnsmasq's `address=//` configuration parameter, but using this approach we can dynamically address remote container `traefik` by sending our requests to the `localhost` in the loopback `lo` interface, providing a way for `traefik` to verify dns challenges from the local `dnsmasq` instance.

```yml
services:

  dnsmasq:
    image: jpillora/dnsmasq:latest
    networks: 
      - main
    volumes:
      - ./config/dnsmasq/dnsmasq.conf:/etc/dnsmasq.conf
      # In the dnsmasq.conf set:
      # server=/_acme-challenge.example.com/127.0.0.1#5353
      # This will allow forwarding of the acme dns challenges to the localhost
      # port 5353, which will be forwarded by twine to traefik container 
    ports:
      - 53:53/tcp
      - 53:53/udp
    labels:
      - twine.nat.interfaces=lo
      # Forward localhost
      - twine.nat.forward.lo.5353/udp=traefik:5353

  helloworld:
    networks:
      - main
    labels:
      - traefik.http.services.helloworld.loadbalancer.server.port=8080
      - traefik.http.routers.helloworld.tls.domains[0].main=example.com
      - traefik.http.routers.helloworld.tls.domains[0].sans=*.example.com

  traefik:
    image: traefik:latest
    networks:
      - main
    ports:
      - 80:80
      - 443:443
    environment:
      - EXEC_PATH=/config/dns-challenge.sh
      # Example dns-challenge.sh, which will spin up dnsmasq instance with the challenge token, The requests comming on the external dnsmasq container will be forwarded here by twine.
      #!/bin/sh
      # CONFIG_FILE=$(mktemp /tmp/dnsmasq.conf.XXXXXX)

      # cat <<EOF > "$CONFIG_FILE"
      # no-resolv
      # log-queries
      # port=5353
      # txt-record=${2%?},"$3"
      # EOF

      # killall dnsmasq || true

      # dnsmasq --conf-file="$CONFIG_FILE" &

    command:
      # ...
      - --certificatesresolvers.letsencrypt.acme.dnschallenge=true
      - --certificatesresolvers.letsencrypt.acme.dnschallenge.provider=exec
    labels:
      - twine.nat.interfaces=eth+

```


## Contribute

### Develop
Docker is required.

- To start development run:
```bash
docker-compose up --build
```

- To install packages while the project is running you can place the dependencies in the `package.json` and run 
```bash
docker-compose exec app pnpm i
```

### Windows

- WSL2>Windows filesystem bridge is extremely slow. It is recommended to place the project files in the WSL2 filesystem. 

```bash
wsl
git clone https://github.com/git-invoice.git 
code git-invoice
``` 
