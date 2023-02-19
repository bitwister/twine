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
		await this.forward()
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
				let commands = []
				
				let commandsDelete = []
				for(let route of routesOld){
					if(!route.destinationIp){
						// TODO: Is this enough?
						continue;	
					}
					commands.push(`/busybox route del ${route.network} gw $(getent hosts ${route.destinationIp}`)
				}

				for(let route of container.routes){
					route.destinationIp = (await docker.exec(container.id, `getent hosts ${route.destination} | awk '{ print $1 }'`)).match(/(\d+\.\d+\.\d+\.\d+)/)[1]
					if(!route.destinationIp){
						log.error(`Failed resolving route destination "${route.destination}" on container.id:${container.id}`)
						continue
					}
					log.info(`Worker: Created route ${route.network}>${route.destinationIp} for ${container.id}`)
					commands.push(`/busybox route add ${route.network} gw ${route.destinationIp}`)
				}

				if(commandsDelete.length){
					await docker.exec(container.id, commandsDelete.join(" | "))
				}

				await docker.exec(container.id, commands.join(" && "))
			}
		}

		await docker.upload(container.id, {
			// TODO: Repalce busybox payload with bundeled twine (zero dependency remote control)
			"/busybox": fs.readFileSync("/busybox"),
		})

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
