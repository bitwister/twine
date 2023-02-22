import fs from "fs"

import * as docker from "@/docker"
import * as utils from "@/utils"
import * as log from "@/log"
import * as types from "@/types"
import * as firewall from "@/firewall"
import config from "@/config"

export class NetworkWorker {
	
	// On a system with multiple twine containers running, its important 
	// that only one of them manages external containers with special twine labels
	containers: Array<types.Container> = []
	cancelSchedule: Function
	hostname: string
	
	constructor(){

	}

	async start(){
		this.hostname = fs.readFileSync("/etc/hostname", {encoding: "utf8"}).trim()
		this.cancelSchedule = utils.schedule(async()=>{
			this.discover()
		}, {every: 1000 * 60 * 5})
	}

	async stop(){
		this.cancelSchedule()
		for(let container of this.containers){
			this.forget(container.id)
		}
	}
	
	async manage(container: types.Container){

		let routesOld = []
		let routesChanged = false
		let _container = this.containers.find(_container=>_container.id==container.id)
		if(_container){
			if(JSON.stringify(container.routes) != JSON.stringify(_container.routes)){
				// Container labels "twine.route" have changed
				routesOld = _container.routes || []
				container = {
					..._container,
					routes: container.routes
				}
				routesChanged = true
			}
		}else{
			// Seeing container first time
			routesChanged = true
		}

		// console.log(container.id, container.routes)

		if(!container.routes.length){
			return;
		}

		// Grab a lock only if needed
		if(!container.lock || Number(new Date()) - container.lock.updated > container.lock.ttl){
			let output = await docker.exec(container.id, `cat /.twinie.lock`)
			if(output){
				try{
					container.lock = JSON.parse(output)
				}catch(error){}
			}
		}

		if(!container.lock || container.lock.owner == this.hostname || Number(new Date()) - container.lock.updated > container.lock.ttl){
			// routesChanged = true
			await docker.upload(container.id, {
				"/.twinie.lock": JSON.stringify({
					owner: this.hostname,
					created: Number(new Date()),
					updated: Number(new Date()),
					ttl: 1000 * 60 * 10
				}),
			})
			if(!(await docker.exec(container.id, `stat /busybox`)).match(/Access\:/)){
				await docker.upload(container.id, {
					"/busybox": fs.readFileSync("/busybox")
				})
			}
			if(routesChanged){
				await docker.exec(container.id, `/busybox route del -net 0.0.0.0/0 gw 172.19.0.1`)
				await docker.exec(container.id, `/busybox route add -net 172.19.0.0/24 gw 172.19.0.1`)

				for(let route of routesOld){
					log.info(`Worker: Created route ${route.network}>${route.destination} on ${container.name}`)
					await docker.exec(container.id, `/busybox route del -net ${route.network} gw ${route.destination}`).catch(()=>{})
				}
				for(let route of container.routes){
					log.info(`Worker: Created route ${route.network}>${route.destination} on ${container.name}`)
					await docker.exec(container.id, `/busybox route add -net ${route.network} gw ${route.destination}`)
				}
			}
		}

		this.containers.push(container)
	}
	
	async forget(containerId){
		await docker.exec(containerId, `rm -f /.twinie.lock && rm -f /busybox`)
		this.containers = this.containers.filter((container)=>container.id != containerId)
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
