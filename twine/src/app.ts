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
	let containers = []
	for(let container of await docker.docker.container.list()){
		if(containerId && container.id != container.data["Id"]) continue;
		let containerInfo = {
			id: container.data["Id"],
			pid: (await container.status()).data["State"]["Pid"],
			name: container.data["Names"][0].replace(/^\//m, ""),
			forwarding: [],
			routes: [],
			gatewayInterface: "", // TODO: autodetect
		}
		for(let [label, value] of Object.entries(container.data["Labels"]) as Array<[string, string]>){
			let labelForward = /^twine\.forward\.(?<sourcePort>\d+)(?:\/(?<protocol>tcp|udp))?$/m.exec(label)
			if(labelForward){
				let valueForward = /^(?<destination>.*?)(?:\:(?<destinationPort>\d+))?$/m.exec(value)
				containerInfo.forwarding.push({
					protocol: labelForward.groups.protocol || "tcp",
					sourcePort: labelForward.groups.sourcePort,
					destination: valueForward.groups.destination,
					destinationPort: valueForward.groups.destinationPort || labelForward.groups.sourcePort,
				})
			}
			let labelRoute = label.match(/^twine\.route\.(?<network>.*?)$/m)
			if(labelRoute){
				containerInfo.routes.push({
					network: labelRoute.groups.network,
					destination: value.trim(),
				})
			}
			let labelGatewayInterface = label.match(/^twine\.gateway\.interface$/m)
			if(labelGatewayInterface){
				containerInfo.gatewayInterface = value.trim()
			}
		}
		containers.push(containerInfo)
	}
	return containers
}

export let update = async(containerId?: string)=>{
	let containers = await scanContainers(containerId)
	for(let container of containers){
		let router = new networking.Router((command)=>docker.execNS(container.pid, command))
		let iptables = new networking.IPTables((command)=>docker.execNS(container.pid, command))
		let networkInterfaces = new networking.NetworkInterfaces((command)=>docker.execNS(container.pid, command))
		if(container.routes.length){
			let routesCurrent = await router.fetch()
			// Change default route metric to 1
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
			for(let containerRoute of container.routes){
				let network = new netmask.Netmask(containerRoute.network)
				let destinationIp = containerRoute.destination
				if(!destinationIp.match(/^([\d\.]+)\.([\d\.]+)\.([\d\.]+)$/m)){
					try{
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
		if(container.gatewayInterface || container.forwarding.length){
			let interfaces = await networkInterfaces.fetch()
			// TODO: simplify
			await docker.execNS(container.pid, `echo 1 > /proc/sys/net/ipv4/ip_forward`)
			await iptables.insert([
				`-D FORWARD -j TWINE_FORWARD`,
				`-t nat -D POSTROUTING -j TWINE_POSTROUTING`,
				`-t nat -D PREROUTING -j TWINE_PREROUTING`,
				`-F TWINE_FORWARD`,
				`-t nat -F TWINE_POSTROUTING`,
				`-t nat -F TWINE_PREROUTING`,
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
				`-A FORWARD -j TWINE_FORWARD`,
				`-t nat -A POSTROUTING -j TWINE_POSTROUTING`,
				`-t nat -A PREROUTING -j TWINE_PREROUTING`,
				`-t nat -A TWINE_POSTROUTING -o eth+ -j MASQUERADE`,
			], {force: true})
			if(container.gatewayInterface){
				await iptables.insert([
					`-A TWINE_FORWARD -d ${container.name} -o ${container.gatewayInterface} -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
					`-A TWINE_FORWARD -i ${container.gatewayInterface} -s ${container.name} -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
					`-t nat -A TWINE_POSTROUTING -o ${container.gatewayInterface} -j MASQUERADE`,
				])
			}
		}
		if(container.forwarding.length){
			let interfaces = await networkInterfaces.fetch()
			for(let forward of container.forwarding){
				let destinationIp = forward.destination
				if(!destinationIp.match(/^([\d\.]+)\.([\d\.]+)\.([\d\.]+)$/m)){
					try{
						destinationIp = (await docker.execNS(container.pid, `nslookup ${forward.destination} 127.0.0.11`)).match(/answer\:.*?Address\:\s+([\d\.]+)/sm)[1]
					}catch(error){
						log.error(`Failed to resolve destination "${destinationIp}" for forwarding ${forward.sourcePort}>${forward.destination}:${forward.destinationPort}/${forward.protocol}`)
						continue
					}
				}

				let rules = []
				for(let [_interface, address] of Object.entries(interfaces)){
					rules.push(`-t nat -A TWINE_PREROUTING -d ${address} -p ${forward.protocol} -m multiport --dports ${forward.sourcePort} -j DNAT --to ${destinationIp}:${forward.destinationPort}`)
				}

				if(await iptables.insert(rules)){
					log.info(`Forwarded ${container.name}:${forward.sourcePort}>${forward.destination}:${forward.destinationPort}/${forward.protocol}`)
				}
			}
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
			log.info("Running test")
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
			await containers["twine-wireguard-client-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-wireguard-client-1"].test(`curl -sS 10.250.0.1:80`)

			await containers["twine-qbittorrent-1"].test(`traceroute -m 2 1.1.1.1`)
			await containers["twine-qbittorrent-1"].test(`traceroute -m 2 10.250.0.1`)
			await containers["twine-qbittorrent-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-qbittorrent-1"].test(`curl -sS 10.250.0.1:80`)
			await containers["twine-qbittorrent-1"].test(`curl -sS 10.250.0.2:80`)
			await containers["twine-qbittorrent-1"].test(`curl -sS wireguard-client:80`)

			await containers["twine-wireguard-server-1"].test(`curl -sS localhost:80`)
			await containers["twine-wireguard-server-1"].test(`curl -sS 10.250.0.1:80`)
			await containers["twine-wireguard-server-1"].test(`curl -sS wireguard-server:80`)
			await containers["twine-wireguard-server-1"].test(`curl -sS ipinfo.io`)
			await containers["twine-wireguard-server-1"].test(`curl -sS 10.250.0.2:80`)

			await containers["twine-helloworld-1"].test(`curl -sS ipinfo.io`)
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

