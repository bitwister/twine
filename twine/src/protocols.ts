import fs from "fs"

import * as log from "@/log"
import * as types from "@/types"
import * as firewall from "@/firewall"
import * as networking from "@/networking"
import * as utils from "@/utils"
import config from "@/config"

export class Protocol {
	interface: types.Interface
	abortController: AbortController
	constructor(){
		this.abortController = new AbortController()
	}
	async setup(){}
	async startServer(){}
	async startClient(){}
	async stop(){}
}


export class OpenVPNProtocol extends Protocol {

	process: any

	constructor(){
		super()
	}

	async installed(): Promise<boolean> {
		return fs.existsSync(`/usr/sbin/openvpn`)
	}

	async setup(){
		if(!fs.existsSync("/config/openvpn")){
			fs.mkdirSync(`/config/openvpn`)
		}

		if(!await this.installed()){
			log.info(`OpenVPN: Installing protocol`)
			// TODO: Install in /data
			await utils.exec(`
apk add --update openvpn easy-rsa
ln /usr/share/easy-rsa/easyrsa /usr/bin/easyrsa 
chmod +x /usr/bin/easyrsa
			`)
		}
		
		if(config.MODE == types.Mode.Server){
			if(!fs.existsSync(`/config/openvpn/pki`)){
				await this.initPKI()
			}
			if(!fs.existsSync(`/config/openvpn/server.ovpn`)){
				await this.generateServerConfig()
			}
		}
	}

	async stop(){
		await utils.exec("killall openvpn")
	}

	async startServer(){
		log.info(`OpenVPN: Starting server`)
		try{await utils.exec(`killall openvpn`, {log: false})}catch(error){}
		networking.waitForTun().then(async()=>{
			await firewall.iptables.setupTunnel()
			await firewall.iptables.forwardAll()
		})
		this.process = await utils.exec(`/usr/sbin/openvpn --config /config/openvpn/server.ovpn `, {
			// signal: this.abortController,
			// wait: false
		})
	}

	async startClient(){
		log.info(`OpenVPN: Starting client`)
		try{await utils.exec(`killall openvpn`, {log: false})}catch(error){}
		networking.waitForTun().then(async()=>{
			await firewall.iptables.setupTunnel()
			await firewall.iptables.forwardAll()
		})
		this.process = await utils.exec(`/usr/sbin/openvpn --config /config/openvpn/client.ovpn`, {
			// signal: this.abortController,
			// wait: false
		})
	}

	async initPKI(){
		log.info(`OpenVPN: Initializing EasyRSA PKI`)
		await utils.exec(`
rm -rf /config/openvpn/pki
easyrsa init-pki
easyrsa build-ca nopass
easyrsa gen-dh
/usr/sbin/openvpn --genkey secret /config/openvpn/pki/ta.key
easyrsa build-server-full server nopass
easyrsa gen-crl
		`, 
		{	
			cwd: "/config/openvpn",
			env: {
				"EASYRSA_BATCH": "1",
				// "EASYRSA_REQ_CN": "CA"
			}
		})
	}

	async generateServerConfig(){
		log.info(`OpenVPN: Generating default /config/openvpn/server.ovpn`)
		fs.writeFileSync(`/config/openvpn/server.ovpn`, `\
server 10.69.0.0 255.255.255.0
route 10.69.0.0 255.255.255.0
proto tcp
port 1194
dev tun
client-to-client

verb 3
key-direction 0
keepalive 10 60
persist-key
persist-tun
user nobody
group nogroup
comp-lzo no

status /tmp/openvpn-status.log
ifconfig-pool-persist /config/openvpn/ipp.txt

push "dhcp-option DNS 1.1.1.1"
push "dhcp-option DNS 1.0.0.1"
push "comp-lzo no"

key /config/openvpn/pki/private/server.key
ca /config/openvpn/pki/ca.crt
cert /config/openvpn/pki/issued/server.crt
dh /config/openvpn/pki/dh.pem
tls-auth /config/openvpn/pki/ta.key
		`, {encoding: "utf8"})
	}

	parseConfig(file){
		let config = {
			protocol: file.match(/^\s*proto (tcp|udp)\s*$/m)[1],
			port: file.match(/^\s*port (\d+)\s*$/m)[1],
		}
		return config
	}

	async generateClientConfig(username){
		log.info(`OpenVPN: Generating client config /config/openvpn/clients/${username}.ovpn`)
		if(!fs.existsSync("/config/openvpn/clients/")){
			fs.mkdirSync("/config/openvpn/clients/")
		}
		let config = this.parseConfig(fs.readFileSync(`/config/openvpn/server.ovpn`, {encoding: "utf8"}))
		fs.writeFileSync(`/config/openvpn/clients/${username}.ovpn`, `\
client
remote 123 ${config.port} ${config.protocol}

nobind
dev tun
key-direction 1
redirect-gateway def1
remote-cert-tls server

<key>
${fs.readFileSync(`/config/openvpn/pki/private/${username}.key`)}
</key>
<cert>
${fs.readFileSync(`/config/openvpn/pki/issued/${username}.crt`)}
</cert>
<ca>
${fs.readFileSync(`/config/openvpn/pki/ca.crt`)}
</ca>
<tls-auth>
${fs.readFileSync(`/config/openvpn/pki/ta.key`)}
</tls-auth>
		`, {encoding: "utf8"})
	}

	async usersCreate(username){
		if(!fs.existsSync(`/config/openvpn/pki/private/${username}.key`)){
			await utils.exec(`
easyrsa build-client-full ${username} nopass
			`, {
				env: {
					"EASYRSA_BATCH": "1",
					"EASYRSA_PKI": "/config/openvpn/pki"
				}
			})
		}
		await this.generateClientConfig(username)
	}

	async usersDelete(username){
		await utils.exec(`
easyrsa revoke ${username}
easyrsa gen-crl
		`, {
			env: {
				"EASYRSA_BATCH": "1",
				"EASYRSA_PKI": "/config/openvpn/pki"
			}
		})
	}
}

export let protocols = {
	"openvpn": OpenVPNProtocol
}

export default exports 