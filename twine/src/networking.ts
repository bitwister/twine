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

// export let init = async()=>{
// 	log.info(`Setting up the firewall`)
// 	// let defaultGateway = (await utils.exec(`ip route`, {log: false})).match(/default\svia\s(.*?)\s/)[1]
// 	await iptables.insert([
// 		`-P INPUT ACCEPT`,
// 		`-P OUTPUT ACCEPT`,
// 		`-P FORWARD DROP`,
// 		`-t nat -P PREROUTING ACCEPT`,
// 		`-t nat -P POSTROUTING ACCEPT`,
// 		`-N TWINE_INPUT`,
// 		`-N TWINE_OUTPUT`,
// 		`-N TWINE_FORWARD`,
// 		`-t nat -N TWINE_POSTROUTING`,
// 		`-A INPUT -j TWINE_INPUT`,
// 		`-A OUTPUT -j TWINE_OUTPUT`,
// 		`-A FORWARD -j TWINE_FORWARD`,
// 		`-t nat -A POSTROUTING -j TWINE_POSTROUTING`,
// 		`-A TWINE_FORWARD -i tun+ -o eth+ -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
// 		`-A TWINE_FORWARD -i eth+ -o tun+ -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
// 		`-t nat -A TWINE_POSTROUTING -o eth+ -j MASQUERADE`,
// 		`-t nat -A TWINE_POSTROUTING -o tun+ -j MASQUERADE`,
// 	], {force: true})
// 	await iptables.forwardAll()
// }

export class IPTables {
	exec: (command: string) => Promise<string>
	constructor(exec?: (command: string) => Promise<string>){
		this.exec = exec || ((command)=>utils.exec(command) as any)
	}
	async reset(){
		// await this.insert([
		// 	`-D INPUT -j TWINE_INPUT`,
		// 	`-D OUTPUT -j TWINE_OUTPUT`,
		// 	`-D FORWARD -j TWINE_FORWARD`,
		// 	`-t nat -D POSTROUTING -j TWINE_POSTROUTING`,
		// 	`-F TWINE_INPUT`,
		// 	`-F TWINE_OUTPUT`,
		// 	`-F TWINE_FORWARD`,
		// 	`-t nat -F TWINE_POSTROUTING`
		// ], {force: true})
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
	async forward({protocol="tcp", sourcePorts, destinationIp, destinationPort}): Promise<Boolean>{
		return await this.insert([`-t nat -A PREROUTING -p ${protocol} -m multiport --dports ${sourcePorts.join(",")} -j DNAT --to ${destinationIp}:${destinationPort}`])
	}
}

export let interfaces = async(): Promise<Array<types.Interface>> =>{
	let interfaces = []
	for(let [name, ips] of Object.entries(os.networkInterfaces())){
		for(let ip of ips){
			if(ip.family == "IPv4"){
				interfaces.push({
					name,
					network: ip.cidr,
					address: ip.address
				})
				break
			}
		}
	}
	return interfaces
}

export let parseRoutes = (data)=>{
	let routes = []
	for(let [_, destination, gateway, mask, metric] of data.matchAll(/^([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+\w+\s+(\d+)\s+/gm)){
		routes.push({
			destination,
			gateway,
			mask,
			metric: Number(metric)
		})
	}
	return routes
}

export let setNameservers = async(nameservers: Array<string>)=>{
	let data = ""
	for(let nameserver of nameservers){
		data += `nameserver ${nameserver}\n`
	}
	fs.writeFileSync("/etc/resolv.conf", data, {encoding: "utf8"})
}

export let iptables = new IPTables()

export default exports