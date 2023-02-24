# Twine

Next generation docker multi-protocol tunneling container that automatically manages routes/forwarding in/out of your containers

**NO MORE SHARED NETWORKING ~~(`network_mode: service:vpn`)~~ 😎🎉** 

Twine provides essential features for rapid development: 
- Easily configureable automatic port forwarding 
- Support for multiple protocols with universal configuration interface (TODO) 
- Config auto generation based on usecase templates (TODO) 
- Simple CLI/API interface for management and config creation

**Supported protocols**
- **OpenVPN** - Client/Server
- **WireGuard** - (TODO)
- **IPSec** - (TODO)
- **Tor** - (TODO)

## Deploy
```yml
version: "3.7"
services:

  nginx:
    image: nginx:latest
    networks:
      - main
    volumes: 
      - ./config/nginx/static:/usr/share/nginx/html
    ports:
      - 0.0.0.0:80:80
    cap_add:
      - NET_ADMIN # Required for twine.route label
    labels:
      # Route outgoing traffic 0.0.0.0/0 to twine_client  
      - twine.route=0.0.0.0/0>twine_client
  
  twine_client:
    image: ghcr.io/bitwister/twine:latest
    restart: unless-stopped
    networks:
      # For the route to work, containers must have a common network
      - main
    volumes:
      #  Docker.sock access required for managing packet forwarding
      -  /var/run/docker.sock:/var/run/docker.sock
      - ./config/twine_edge/client.ovpn:/config/openvpn/client.ovpn
    environment:
      MODE: client
      PROTOCOL: openvpn
      # Forward incomming connections on VPN client's address to
      # the specified services
      PORTS: >
        80,8080-8090>nginx:80
      # {port},{port},...:{destination}:{destinationPort}[/tcp|/udp]

    cap_add:
      - NET_ADMIN

networks:
	main
```

## API

### **Environment**
| Variable | Values | Default | Description |
| - | - | - | - |
| LOG_LEVEL | `debug,info` | `info` | Logging level |
| MODE | `server,client` | `server` | |
| PROTOCOL | `openvpn` | `openvpn` | |
| PORTS | `{port},{port...}>{destination}:{port}` | | Port forward incoming VPN traffic |
| SERVER | `{ip/hostname}` | `curl ipinfo.io` | Server's public address |  


### **Volumes**
| Mount | Description |
| - | - |
| /var/run/docker.sock | Docker mangement socket |
| /config | Configuration files for all protocols |
| /config/openvpn/server.ovpn |  |
| /config/openvpn/client.ovpn |  |
| /config/openvpn/pki |  |
| /config/openvpn/clients |  |


### **Labels**
| Name | Values | Description |
| - | - | - |
| twine.route | `{CIDR}>{destination}` | `server` | Route `{CIDR}` to the `{destination}` |


### **CLI**

You can call CLI interface with: 

`docker exec -ti <container> twine --help` 

```
Usage:
	twine start 
	twine cleanup
	twine openvpn-add <username>
	twine openvpn-revoke <username>

Options:
	-h, --help 
```

## Contribute

### Develop
- Start the development environment
```
git clone https://github.com/bitwister/twine.git
cd twine
docker-compose up --build
```
- Open docker container via [Remote Development Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack)

### Moneh

I like moneh

XMR - `47h5CYGYDFNN8z7tAyXqbtcTep8pMidJfe66g8CL65u7gun6eJ9aew9PnwhTaYbV5L2rpDZhwv4gmAxf5tMbwuDBT8MJes5`

