import fs from "fs"
import * as netmask from "netmask"

import * as networking from "@/networking"
import * as docker from "@/docker"
import * as utils from "@/utils"
import * as log from "@/log"
import * as types from "@/types"
import * as firewall from "@/firewall"
import config from "@/config"

export class NetworkWorker {
	
	// On a system with multiple twine containers running, its important 
	// that only one of them manages external containers with special twine labels
	managedContainers: Array<types.Container> = []
	cancelSchedule: Function
	hostname: string
	
	constructor(){}

	async start(){
		this.hostname = fs.readFileSync("/etc/hostname", {encoding: "utf8"}).trim()
		this.cancelSchedule = utils.schedule(async()=>{
			this.discover()
		}, {every: 1000 * 60 * 5})
	}

	async stop(){
		this.cancelSchedule()
		for(let container of this.managedContainers){
			this.forget(container.id)
		}
	}
	
	async manage(container: types.Container){

		if(!container.routes.length) return;
		let router = new networking.Router((command)=>docker.exec(container.id, `/busybox ${command}`))
		let managedContainer = this.managedContainers.find(_container=>_container.id==container.id)
		if(managedContainer){
			if(JSON.stringify(container.routes) != JSON.stringify(managedContainer.routes)){
				container = {
					...managedContainer,
					routes: container.routes
				}
			}
		}

		// Because multiple twine instances could be running on the same docker host
		//  to avoid logic collision a lock mechanism is implemented
		let output = await docker.exec(container.id, `cat /.twine.lock`)
		if(output){
			try{
				container.lock = JSON.parse(output)
			}catch(error){}
		}
		if(!container.lock){
			if(!(await docker.exec(container.id, `stat /busybox`)).match(/Access\:/)){
				await docker.upload(container.id, {
					"/busybox": fs.readFileSync("/busybox")
				})
			}
			container.lock = {
				owner: this.hostname,
				created: Number(new Date()),
				updated: Number(new Date()),
				ttl: 1000 * 60 * 10
			}
		}

		if(container.lock.owner != this.hostname) return;

		container.lock.updated = Number(new Date())
		await docker.upload(container.id, {
			"/.twine.lock": JSON.stringify(container.lock)
		})

		let routesCurrent = await router.fetch()
		let routeDocker = routesCurrent.find(route=>
			route.gateway == "0.0.0.0" 
				&& 
			route.mask == "255.255.0.0"
		)
		let gatewayDocker = routeDocker.destination.replace(/\.0$/m, ".1")
		let routeDefault = routesCurrent.find(route=>
			route.destination == "0.0.0.0" 
				&& 
			route.mask == "0.0.0.0" 
				&& 
			route.metric == 0
				&&
			route.gateway == gatewayDocker
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
			if(destinationIp.toLowerCase() == "docker_gateway"){
				destinationIp = gatewayDocker
			}else if(!destinationIp.match(/^([\d\.]+)\.([\d\.]+)\.([\d\.]+)$/m)){
				destinationIp = (await docker.exec(container.id, `/busybox nslookup ${containerRoute.destination}`)).match(/answer\:.*?Address\:\s+([\d\.]+)/sm)[1]
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
				log.info(`Worker: Created route ${containerRoute.network}>${containerRoute.destination} on ${container.name}`)
				await router.add(route)
			}
		}

		// TODO: Come up with an automated solution to the external access failure when routing 0.0.0.0/0

		this.managedContainers.push(container)
	}
	
	async forget(containerId){
		await docker.exec(containerId, `rm -f /.twinie.lock && rm -f /busybox`)
		this.managedContainers = this.managedContainers.filter((container)=>container.id != containerId)
	}
	
	async discover(){
		for(let containerDocker of await docker.list()){
			let labelConfig = utils.parseDockerTwineLabels(containerDocker.data.Labels)
			let container: types.Container = {
				id: containerDocker.id,
				name: containerDocker.data.Names[0].replace(/\//g, ""),
				routes: labelConfig.routes,
			}
			this.manage(container)
		}
	}
	
	async forward (){
		for(let [_, ports, destination, destinationPort, protocol] of config.PORTS.matchAll(/^\s*(?:((?:\d+,?)+)+>(.*?)\:(\d+)(?:\/(tcp|udp))?)/mg)){
			await firewall.iptables.forward({
				protocol: protocol || "tcp", 
				sourcePorts: ports.split(","), 
				destination, 
				destinationPort
			})
		}
	}
}
