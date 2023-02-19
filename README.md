# Twine

Next generation docker multi-protocol tunneling container that automatically manages routes/forwarding in/out of your containers.

**NO MORE SHARED NETWORKING ~~(`network_mode: service:vpn`)~~ 😎🎉**

Spend less time configuring vpn containers, and focus on architecture for your next big project/company/startup

Twine provides many essential features for rapid development: 
- Easily configureable automatic port forwarding 
- Standartized multi-protocol interface (Twine only downloads the protocol you use, saving space)
- Rapid deployment with automatic usecase-based templates for server configuration  
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
      # Route outgoing traffic 0.0.0.0/0 to twine_edge  
      - twine.route=0.0.0.0/0>twine_edge
      # This will automatically create/update route to the twine_edge gateway 
      #  based on latest Docker DNS updates
  
  # docker-compose exec twine_edge netpipe.py openvpn adduser <username>
  twine_edge:
    image: ghcr.io/bitwister/twine:latest
    restart: unless-stopped
    networks:
      # For packet forwarding to work, containers must share at-least one network
      - main
    volumes:
      #  Docker access required for managing packet forwarding
      -  /var/run/docker.sock:/var/run/docker.sock
      - ./config/netpipe_edge/:/config
      - ./data/netpipe_edge/:/data
    environment:
      PORTS: >
        80,8080-8090>nginx:80
        25565:192.168.1.14:25565
      # {port},{port},...:{destination}:{destinationPort}[/tcp|/udp]
      # Domain names and networks are relative to this container
      # 80,8080-8090>nginx:80 - Route to internal nginx on common "main" network
      # 25565:192.168.1.14:25565 - Route minecraft server port to a home network ip
      
    cap_add:
      - NET_ADMIN

networks:
	main
```

## API

### **Environment**
| Variable | Values | Default | Description |
| - | - | - | - |
| MODE | `server,client` | `server` | |
| PROTOCOL | `openvpn` | `openvpn` | |
| PORTS | `{port},{port...}>{destination}:{port}` | | Port forward incoming VPN traffic |

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
	twine start [options]
	twine cleanup
	twine openvpn create <username>
	twine openvpn revoke <username>

Options:
  cleanup   Removes automatically created routes (called before container stops)

```

## Contribute

### Develop
- Start the development environment
```
git clone 
cd
docker-compose up --build
```
- Open docker container via (Remote Development Extension)[https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack] 

### Moneh

I like moneh

XMR - `47h5CYGYDFNN8z7tAyXqbtcTep8pMidJfe66g8CL65u7gun6eJ9aew9PnwhTaYbV5L2rpDZhwv4gmAxf5tMbwuDBT8MJes5`

