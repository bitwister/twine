import fs from "fs"
import process from "process"
import neodoc from "neodoc"
import * as netmask from "netmask"

import * as types from "@/types"
import * as utils from "@/utils"
import * as log from "@/log"

import * as networking from "@/networking"
import * as docker from "@/docker"

import config from "@/config"

let doc = `
Usage:
	twine start 
	twine cleanup

Options:
	-h, --help 
`.replace(/\t/g, " ".repeat(4))

process.on("unhandledRejection", (reason, promise) => {
	if(config.LOG_LEVEL == "debug"){
		console.error(reason)
	}
	log.debug("UnhandledRejection:", reason)
})

export let cleanup = async()=>{
	log.info("Cleaning up...")
	// TODO
}

export let scanContainers = async(containerId?: string): Promise<Array<types.Container>>=>{
	let containers: Array<types.Container> = []
	for(let container of await docker.docker.container.list()){
		if(containerId && container.id != container.data["Id"]) continue;

		let containerInfo: types.Container = {
			id: container.data["Id"],
			pid: (await container.status()).data["State"]["Pid"],
			name: container.data["Names"][0].replace(/^\//m, ""),
			nat: {
				interfaces: [],
				portForwarding: [],
			},
			host: {
				routes: []
			},
			routes: [],
		}
		for(let [label, value] of Object.entries(container.data["Labels"]) as Array<[string, string]>){
			if(!label.startsWith("twine\.")) continue;

// TODO: DEPRICATED
// twine.forward.80=helloworld
// twine.forward.80/tcp=helloworld
// twine.forward.80/tcp=helloworld:74/tcp
			let labelForwardDepricated = /^twine\.forward\.(?<sourcePort>\d+)(?:\/(?<protocol>tcp|udp))?$/m.exec(label)
			if(labelForwardDepricated){
				let valueForward = /^(?<destination>.*?)(?:\:(?<destinationPort>\d+))?$/m.exec(value)
				containerInfo.nat.portForwarding.push({
					interface: "+",
					protocol: labelForwardDepricated.groups.protocol || "tcp",  					sourcePort: labelForwardDepricated.groups.sourcePort,
					destination: valueForward.groups.destination,
					destinationPort: valueForward.groups.destinationPort || labelForwardDepricated.groups.sourcePort,
				})
				log.error(`Container "${container.name}" using depricated twine label "${labelForwardDepricated[0]}", update to "twine.nat.+.forward.<sourcePort>[/tcp\|udp]=<destination>:<port>" as soon as possible`)
			}

// twine.nat.forward.+.80=helloworld
// twine.nat.forward.+.80/tcp=helloworld
// twine.nat.forward.+.80/tcp=helloworld:74/tcp
			let labelForward = /^twine\.nat\.forward\.(?:(?<interface>.*?)\.)?(?<sourcePort>\d+)(?:\/(?<protocol>tcp|udp))?$/m.exec(label)
			if(labelForward){
				let valueForward = /^(?<destination>.*?)(?:\:(?<destinationPort>\d+))?$/m.exec(value)
				containerInfo.nat.portForwarding.push({
					interface: labelForward.groups.interface || "+",
					protocol: labelForward.groups.protocol || "tcp",
					sourcePort: labelForward.groups.sourcePort,
					destination: valueForward.groups.destination,
					destinationPort: valueForward.groups.destinationPort || labelForward.groups.sourcePort,
				})
			}

// twine.host.routes=10.250.0.0/24,127.0.0.1
			let labelHostRoutes = label.match(/^twine\.host\.routes$/m)
			if(labelHostRoutes){
				containerInfo.host.routes = value.trim().split(",")
			}

// twine.route.128.0.0.0/1=wireguard-client
			let labelRoute = label.match(/^twine\.route\.(?<network>.*?)$/m)
			if(labelRoute){
				containerInfo.routes.push({
					network: labelRoute.groups.network,
					destination: value.trim(),
				})
			}

// TODO: DEPRICATED
// twine.gateway.interface=wg+
			let labelGatewayInterfaceDepricated = label.match(/^twine\.gateway\.interface$/m)
			if(labelGatewayInterfaceDepricated){
				containerInfo.nat.interfaces = value.trim().split(",")
				log.error(`Container "${container.name}" using depricated twine label "${labelForwardDepricated[0]}", update to "twine.nat.interfaces=<interface>[,<interface>...]" as soon as possible`)
			}

// twine.nat.interfaces=wg+
			let labelGatewayInterface = label.match(/^twine\.nat\.interfaces$/m)
			if(labelGatewayInterface){
				containerInfo.nat.interfaces = value.trim().split(",")
			}

// twine.forwarding.interface.wg+.whitelist=
// twine.forwarding.interface.wg+.whitelist.in=
// twine.forwarding.interface.wg+.whitelist.out=

		}
		containers.push(containerInfo)
	}
	return containers
}

export let update = async(containerId?: string)=>{
	let containers = await scanContainers(containerId)

	// let hostRouter: networking.Router
	// if(fs.existsSync("/host/proc/1")){
	// 	// I cant for the fuck of me figure out how to pull proper network namespace for the host
	// 	// on WSL2 via the new `pid: host` method
	// 	// For now this is the only dependency holding back from removing /proc:/host/proc mount
	// 	hostRouter = new networking.Router(command=>utils.exec(`nsenter -n/host/proc/1/ns/net ${command}`) as any)
	// }else{
	// 	hostRouter = new networking.Router(command=>docker.execNS(1, command) as any)
	// }
	// let hostRoutes = await hostRouter.fetch()

	for(let container of containers){

		try{
			let router = new networking.Router((command)=>docker.execNS(container.pid, command))
			let iptables = new networking.IPTables((command)=>docker.execNS(container.pid, command))
			let networkInterfaces = new networking.NetworkInterfaces((command)=>docker.execNS(container.pid, command))
			// let containerInterfaces = await networkInterfaces.fetch()

// twine.route.128.0.0.0/1=wireguard-client
// Create a route on the container to the destination `128.0.0.0/1` with gateway `wireguard-client`
			if(container.routes.length){
				// Change default route metric to 1
				let routesCurrent = await router.fetch()
				let routeDefault = routesCurrent.find(route=>
					route.destination == "0.0.0.0" 
						&& 
					route.mask == "0.0.0.0" 
						&& 
					route.metric == 0
				)
				if(routeDefault){
					await router.del(routeDefault)
					await router.add({
						...routeDefault,
						metric: 1
					})
				}
				
				// Update container routes if required
				for(let containerRoute of container.routes){
					let network = new netmask.Netmask(containerRoute.network)
					let destinationIp = containerRoute.destination
					if(!destinationIp.match(/^([\d\.]+)\.([\d\.]+)\.([\d\.]+)$/m)){
						try{
							// Destination ip can change during container lifecycle
							destinationIp = (await docker.execNS(container.pid, `nslookup ${containerRoute.destination} 127.0.0.11`)).match(/answer\:.*?Address\:\s+([\d\.]+)/sm)[1]
						}catch(error){
							log.error(`Failed to resolve destination "${destinationIp}" for route ${containerRoute.network}>${containerRoute.destination} on ${container.name}`)
							continue
						}
					}
					let route: types.IPRoute = {
						gateway: destinationIp,
						destination: network.base,
						mask: network.mask,
						metric: 0
					}
					// Only create the route if its not created yet
					if(!routesCurrent.find(_route=>
						_route.destination == route.destination
							&& 
						_route.gateway == route.gateway
							&& 
						_route.mask == route.mask
					)){
						await router.add(route)
						log.info(`Created route ${containerRoute.network}>${containerRoute.destination} on ${container.name}`)
					}
				}
			}

			// Reset iptables rules with TWINE_* namespace
			await iptables.insert([
				`-D FORWARD -j TWINE_FORWARD`,
				`-t nat -D POSTROUTING -j TWINE_POSTROUTING`,
				`-t nat -D PREROUTING -j TWINE_PREROUTING`,
				`-t nat -D OUTPUT -j TWINE_OUTPUT`,
				`-F TWINE_FORWARD`,
				`-t nat -F TWINE_POSTROUTING`,
				`-t nat -F TWINE_PREROUTING`,
				`-t nat -F TWINE_OUTPUT`,
			], {force: true})
			await iptables.insert([
				`-P INPUT ACCEPT`,
				`-P OUTPUT ACCEPT`,
				`-P FORWARD ACCEPT`,
				`-t nat -P PREROUTING ACCEPT`,
				`-t nat -P POSTROUTING ACCEPT`,
				`-N TWINE_FORWARD`,
				`-t nat -N TWINE_POSTROUTING`,
				`-t nat -N TWINE_PREROUTING`,
				`-t nat -N TWINE_OUTPUT`,
				`-A FORWARD -j TWINE_FORWARD`,
				`-t nat -A POSTROUTING -j TWINE_POSTROUTING`,
				`-t nat -A PREROUTING -j TWINE_PREROUTING`,
				`-t nat -A OUTPUT -j TWINE_OUTPUT`,
				`-t nat -A TWINE_POSTROUTING -o eth+ -j MASQUERADE`,
			], {force: true})
			
			// Add forwarding rules between container interface and `twine.gateway.interface` 
			if(container.nat.interfaces.length){
				// TODO: is this needed? (this can also be done via container's sysctls)
				await docker.execNS(container.pid, `echo 1 > /proc/sys/net/ipv4/ip_forward`) 
				
				for(let natInterface of container.nat.interfaces){
					// TODO: More specific forwarding rules? or separte whitelisting function
					if(await iptables.insert([
						`-A TWINE_FORWARD -d ${container.name} -o ${natInterface} -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
						`-A TWINE_FORWARD -i ${natInterface} -s ${container.name} -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
						`-t nat -A TWINE_POSTROUTING -o ${natInterface} -j MASQUERADE`,
					])){
						log.info(`Enabled NAT for "${natInterface}" interface on "${container.name}"`)
					}
				}
			}
			
// twine.nat.+.forward.80/tcp=helloworld:74/tcp
			// Forwarding of `80/tcp` traffic comming on `twine.gateway.interface` to `helloworld:74/tcp`
			// The destination can be any resolavable by dns name (default:container's dns)
			if(container.nat.portForwarding.length){
				let containerInterfaces = await networkInterfaces.fetch()
				await docker.execNS(container.pid, `sysctl -w net.ipv4.conf.all.route_localnet=1`)
				for(let rule of container.nat.portForwarding){
					let destinationIp = rule.destination
					if(!destinationIp.match(/^([\d\.]+)\.([\d\.]+)\.([\d\.]+)$/m)){
						try{
							destinationIp = (await docker.execNS(container.pid, `nslookup ${rule.destination} 127.0.0.11`)).match(/answer\:.*?Address\:\s+([\d\.]+)/sm)[1]
						}catch(error){
							log.error(`Failed to resolve destination "${destinationIp}" for forwarding ${rule.sourcePort}>${rule.destination}:${rule.destinationPort}/${rule.protocol}`)
							continue
						}
					}

					let rules = []
					for(let [interfaceName, address] of Object.entries(containerInterfaces)){
						if(!networking.matchNetworkInterface(rule.interface, interfaceName)) continue;
						if(!container.nat.interfaces.find(natInterface=>networking.matchNetworkInterface(natInterface, interfaceName))){
							// log.error(`Failed applying NAT port forwarding rule for container "${container.name}": NAT is not enabled for the container, try enabling it by adding "twine.nat.interfaces=${interfaceName}"`)
							continue;
						}
						rules.push(`-t nat -A TWINE_PREROUTING -d ${address} -p ${rule.protocol} -m multiport --dports ${rule.sourcePort} -j DNAT --to ${destinationIp}:${rule.destinationPort}`)
						rules.push(`-t nat -A TWINE_OUTPUT -d ${address} -p ${rule.protocol} -m multiport --dports ${rule.sourcePort} -j DNAT --to ${destinationIp}:${rule.destinationPort}`)
					}

					if(await iptables.insert(rules)){
						log.info(`Created NAT forwarding rule ${container.name}:(${rule.interface}):${rule.sourcePort} > ${rule.destination}:${rule.destinationPort}/${rule.protocol}`)
					}
				}
			}
			
// twine.host.routes=10.250.0.0/24,10.20.0.0/26
			// Create routes to `10.250.0.0/24`, `10.20.0.0/26` on the host's operating system that 
			// dynamically resolve current ip address of the container and forward traffic from host 
			// on those networks to the containers docker network interface 
			// if(container.host.routes.length){

			// 	// TODO: there are multiple interfaces on the docker container for each network defined in the `networks:` section
			// 	// 	theoretically host can access the container with any of them, but maybe specific network is more preffered in some situations (? new label)
			// 	let containerHostIp = containerInterfaces[Object.keys(containerInterfaces).find(name=>name.match(/^eth\d/m)) as any]
			// 	for(let containerHostRoute of container.host.routes){
			// 		let network = new netmask.Netmask(containerHostRoute)
			// 		let hostRoute = hostRoutes.find(route=>route.destination==network.base && route.mask==network.mask)
			// 		// TODO: WSL2: route add -host 172.22.0.3 dev eth0
			// 		if(hostRoute && hostRoute.gateway != containerHostIp){
			// 			await hostRouter.del(hostRoute)
			// 		}
			// 		await hostRouter.add({
			// 			destination: network.base,
			// 			mask: network.mask,
			// 			gateway: containerHostIp,
			// 			metric: 0,
			// 		})
			// 		log.info(`Updated host route "${containerHostRoute}" to container "${container.name}" at "${containerHostIp}"`)
			// 	}
			// }
		}catch(error){
			log.error(`Error during processing of container "${container.name}"`, error)
		}
	}
}

async function init(){
	let options = neodoc.run(doc)
	await docker.init()


	if(options["start"]){
		process.once("SIGTERM", cleanup)
		process.once("SIGINT", cleanup)

		docker.docker.events({})
			.then(stream=>{
				stream.on("data", (data)=>{
					let event = JSON.parse(data.toString())
					if(event.Type == "container" && ["restart", "start"].indexOf(event.Action) != -1){
						update(event.id)
					}
				})
			})

		log.info("Ready")
		
		await update()

		if(config.DEV){
			log.info("Running tests")
			// return
			
			let containers = {}
			for(let container of await scanContainers()){
				containers[container.name] = {
					...container,
					test: async(command)=>{
						log.info(`${container.name}: Running "${command}"`)
						console.log((await docker.execNS(container.pid, command, {ignore: true})).slice(0, 250))
					}
				}
			}

			await containers["twine-wireguard-client-1"].test(`curl -sS localhost:80`)
			await containers["twine-wireguard-client-1"].test(`curl -sS 10.250.0.2:80`)
			await containers["twine-wireguard-client-1"].test(`curl -sS wireguard-client:80`)
			// await containers["twine-wireguard-client-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-wireguard-client-1"].test(`curl -sS 10.250.0.1:80`)

			await containers["twine-qbittorrent-1"].test(`traceroute -m 2 1.1.1.1`)
			await containers["twine-qbittorrent-1"].test(`traceroute -m 2 10.250.0.1`)
			// await containers["twine-qbittorrent-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-qbittorrent-1"].test(`curl -sS 10.250.0.1:80`)
			await containers["twine-qbittorrent-1"].test(`curl -sS 10.250.0.2:80`)
			await containers["twine-qbittorrent-1"].test(`curl -sS wireguard-client:80`)

			await containers["twine-wireguard-server-1"].test(`curl -sS localhost:80`)
			await containers["twine-wireguard-server-1"].test(`curl -sS 10.250.0.1:80`)
			await containers["twine-wireguard-server-1"].test(`curl -sS wireguard-server:80`)
			// await containers["twine-wireguard-server-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-wireguard-server-1"].test(`curl -sS 10.250.0.2:80`)

			// await containers["twine-helloworld-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-helloworld-1"].test(`curl -sS wireguard-server:80`)

		}

		while(true){
			await utils.sleep(1000)
		}
	}

	await cleanup()
	process.exit(0)
}

init().catch((console.error))

