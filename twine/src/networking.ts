import os from "os"
import fs from "fs"

import * as utils from "@/utils"
import * as types from "@/types"

export class Router {
	exec: (command: string) => Promise<string>
	constructor(exec?: (command: string) => Promise<string>){
		this.exec = exec || ((command)=>utils.exec(command) as any)
	}
	async fetch(): Promise<Array<types.IPRoute>>{
		let routes: Array<types.IPRoute> = []
		let output = await this.exec(`route -ne`)
		for(let [_, destination, gateway, mask, metric] of output.matchAll(/^([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+\w+\s+(\d+)\s+/gm)){
			routes.push({
				destination,
				gateway,
				mask,
				metric: Number(metric)
			})
		}
		return routes
	}
	async add(route: types.IPRoute){
		await this.exec(`route add -net ${route.destination} netmask ${route.mask} gw ${route.gateway} metric ${route.metric}`)
	}
	async del(route: types.IPRoute){
		await this.exec(`route del -net ${route.destination} netmask ${route.mask} gw ${route.gateway} metric ${route.metric}`)
	}
}

export class IPTables {
	exec: (command: string) => Promise<string>
	constructor(exec?: (command: string) => Promise<string>){
		this.exec = exec || ((command)=>utils.exec(command) as any)
	}
	async check(rule){
		try{
			return !Boolean((await this.exec(`iptables ${rule.replace(/(?:^|\s)-A\s/m, " -C ")}`)).trim())
		}catch(error){
			return false
		}
	}
	async insert(rules: Array<string>, {force=false}={}): Promise<Boolean>{
		let updated = false
		for(let rule of rules){
			if(!force&&rule.match(/(?:^|\s)-A\s/m) && await this.check(rule)) continue;
			try{
				await this.exec(`iptables ${rule}`)
				updated = true
			}catch(error){
				if(!force){
					throw error
				}
			}
		}
		return updated
	}
	async remove(rules){
		for(let rule of rules){
			if(!rule.match(/(?:^|\s)-A\s/m)) continue;
			await this.exec(`iptables ${rule.replace(/(?:^|\s)-A\s/m, " -D ")}`)
		}
	}
}

export let iptables = new IPTables()

export default exports