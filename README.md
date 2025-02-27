# Twine
### Automated management of Docker container networking via labels. 

Currently Routing/Traffic forwarding implementations rely on `network_mode: service:vpn`, which merge existing networks into one, creating some limitations, break network isolation and make it harder to write/read complex deployment configurations. 

Twine is created to improve this process with a simple label-based (similar to Traefik) solution that is easy to configure and preserves containers full isolation.

Twine works by modifying container networking like iptables, routes, sysctl via `pid: host` with `nsenter` in network layer of the docker containers. This preserves container network isolation, while keeping the changes in the temporary layer that gets automatically cleaned up in container lifecycle.


## API Referrence

### Container labels

These labels, simillarly to the Traefik, apply networking configuration to the container, if specified in the `labels:` section of docker-compose.

- #### `twine.nat.interfaces=<interface>[,<interface>...]`
  > `twine.nat.interfaces=wg+,eth+`
  
  > `twine.nat.interfaces=+`

  Enable NAT (forwarding) for the specified interfaces (patterns)

- #### `twine.nat.forward.[<interface>].<sourcePort>[/tcp\|udp]=<destination>:<port>`
  > `twine.nat.forward.eth0.25565/tcp=minecraft:25565`

  > `twine.nat.forward.wg+.80=nginx:80`

  > `twine.nat.forward.80=nginx:80`

  Forward incoming connections on sourcePort to specified destination 

- #### `twine.route.<network>=<destination>`
  > `twine.route.192.168.0.1/24=wireguard`

  > `twine.route.0.0.0.0/0=wireguard`

  Create a route 

- #### `twine.iptables.rule.<name>=<iptables_rule>`
  > `twine.iptables.rule.blockAll=WINE_INPUT -s 10.250.0.1/24 -d 0.0.0.0 -j DROP`
  
  > `twine.iptables.rule.allowVPN=TWINE_INPUT -s 10.250.0.1/24 -d 10.250.0.1/24 -j ACCEPT`

  Create a custom iptables rule with a `<name>`.

  Avaialble chains:
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

### **Environment**
| Variable | Values | Default | Description |
| - | - | - | - |
| `LOG_LEVEL` | `debug,info` | `info` | Logging level |

### **Volumes**
| Container path | Description |
| - | - |
| `/var/run/docker.sock` | Docker mangement socket |

## Usecase Examples

### VPN Infrastracture
```yml
version: "3"
services:
  
  twine:
    image: ghcr.io/bitwister/twine:latest
    restart: unless-stopped
    # Required access:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    privileged: true
    pid: host
  
  wireguard-client:
    image: lscr.io/linuxserver/wireguard:latest
    restart: unless-stopped
    networks:
      - main
    cap_add:
      - NET_ADMIN
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
    volumes:
      - ./config/wireguard/wg0.conf:/config/wg0.conf:ro
    labels:
      # Interface for forwarding traffic (Required for "twine.route.*=wireguard-client" to work) 
      - twine.nat.interfaces=wg+
      # Expose qbittorrent on WireGuard Client ip address
      - twine.nat.forward.9080=qbittorrent:9080

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    restart: unless-stopped
    networks:
      - main
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
      - WEBUI_PORT=9080
    ports:
      - 127.0.0.1:9080:9080
    labels:
      # Route all outgoing traffic via WireGuard Client
      - twine.route.0.0.0.0/1=wireguard-client
      - twine.route.128.0.0.0/1=wireguard-client
      # Route only internal subnet via WireGuard Client
      # - twine.route.10.250.0.0/24=wireguard-client

networks:
  main:
```

### LetsEncrypt Traefik DNS Challenge with dnsmasq 
TODO


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
