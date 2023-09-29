# Twine
### Automated management of Docker container networking via labels. 

Currently Routing/Traffic forwarding implementations rely on `network_mode: service:vpn`, which merge existing networks into one, creating some limitations, break network isolation and make it harder to write/read complex deployment configurations. 

Twine is created to improve this process with a simple label-based (similar to Traefik) solution that is easy to configure and preserves containers full isolation.

This container works by modifying iptables, routes etc via `/proc:/host/proc` hook with `nsenter` in network layer of the docker containers. This preserves container isolation, while keeping the changes in the temporary layer that gets automatically cleaned up on container restarts.

### Features:
- Routing
- Port forwarding
- Traffic forwarding 
- Automatic management on containers restart/update
- iptables rules namespace isolation. All iptables rules added by the twine live in the `TWINE_*` namespace to avoid collision with existing container rules 

## Deploy Example
```yml
version: "3"
services:
  
  twine:
    image: ghcr.io/bitwister/twine:latest
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc
    privileged: true
  
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
      - twine.gateway.interface=wg+
      # Expose qbittorrent on WireGuard Client ip address
      - twine.forward.9080=qbittorrent:9080

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

## API

### **Environment**
| Variable | Values | Default | Description |
| - | - | - | - |
| `LOG_LEVEL` | `debug,info` | `info` | Logging level |

### **Volumes**
| Container path | Description |
| - | - |
| `/var/run/docker.sock` | Docker mangement socket |
| `/host/proc` | Host machine /proc access (Used for network layer patching) |

### **Labels**
| Name | Example | Description |
| - | - | - |
| `twine.gateway.interface` | `wg+` | Interface for forwarding incoming traffic (Required for "twine.route.*=" to work)  |
| `twine.forward.<sourcePort>[/tcp\|udp]=<destination>:<port>` | `twine.forward.9080=qbittorrent:9080` | Forward incoming connections on sourcePort to specified destination | 
| `twine.route.<network>=<destination>` | `twine.route.10.250.0.0/24=wireguard-client` | Route specified network to the specified destination |

## Contribute

### Develop
- Start the development environment
```
git clone https://github.com/bitwister/twine.git
cd twine
docker-compose up --build
```
Changes are automatically detected from your filesystem and deployed instantly.

### Moneh

I like moneh

XMR - `47h5CYGYDFNN8z7tAyXqbtcTep8pMidJfe66g8CL65u7gun6eJ9aew9PnwhTaYbV5L2rpDZhwv4gmAxf5tMbwuDBT8MJes5`

