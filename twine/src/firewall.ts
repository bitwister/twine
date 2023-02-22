import child_process from "child_process"

import * as utils from "@/utils"
import * as log from "@/log"
import * as types from "@/types"
import * as networking from "@/networking"
import config from "@/config"

export let init = async()=>{
	log.info(`Setting up the firewall`)
	await utils.exec(`
iptables -P OUTPUT ACCEPT
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A FORWARD -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -d 1.1.1.1 -j ACCEPT
	`, {log: false})

	await iptables.updateInterfaces()
}

export class IPTables {
	constructor(){}
	async fetch(){
		return [
			...(await utils.exec(`iptables -S`)).split("\n"),
			...(await utils.exec(`iptables -t nat -S`)).split("\n").map(rule=>`-t nat ${rule}`)
		]
	}
	async reset(){
		await this.insert([
			"-F",
			"-X",
			"-P INPUT ACCEPT",
			"-P FORWARD ACCEPT",
			"-P OUTPUT ACCEPT",
		])
	}
	async updateInterfaces(){
		for(let _interface of await networking.interfaces()){
			if(_interface.name.startsWith("eth")){
				await this.insert([
					`-A INPUT -i ${_interface.name} -j ACCEPT`,
					// `-A INPUT -s ${_interface.network} -j ACCEPT`,
					`-A FORWARD -i ${_interface.name} -j ACCEPT`,
					// `-A FORWARD -d ${_interface.network} -j ACCEPT`,
					// `-A FORWARD -s ${_interface.network} -j ACCEPT`,
					// `-A OUTPUT -d ${_interface.network} -j ACCEPT`,
					`-A OUTPUT -o ${_interface.name} -j ACCEPT`,
				])
			}
		}
	}
	async check(rule){
		try{
			await utils.exec(`iptables ${rule.replace(" -A ", " -C ")}`)
			return false
		}catch(error){
			return true
		}
	}
	async insert(rules: Array<string>){
		for(let rule of rules){
			if(rule.match(/\s+\-A\s+/) && await this.check(rule)) continue;
			await utils.exec(`iptables ${rule}`)
		}
	}
	async remove(rules){
		for(let rule of rules){
			if(!rule.match(/\s+\-A\s+/)) continue;
			await utils.exec(`iptables ${rule.replace(" -A ", " -D ")}`)
		}
	}
	async forward({protocol="tcp", sourcePorts, destination, destinationPort}){
		await this.insert([`-t nat -A PREROUTING -i tun0 -p ${protocol} -m multiport --dports ${sourcePorts.join(",")} -j DNAT --to ${await utils.resolveIp(destination)}:${destinationPort}`])
		log.info(`Forwarded ${sourcePorts}>${destination}:${destinationPort}/${protocol}`)
	}
	async setupTunnel(){
		await this.insert([
			`-t nat -A POSTROUTING -o tun0 -j MASQUERADE`,
			`-A OUTPUT -o tun0 -j ACCEPT`,
			`-A INPUT -i tun0 -j ACCEPT`
		])
		for(let _interface of await networking.interfaces()){
			if(_interface.name.startsWith("eth")){
				await this.insert([
					`-A FORWARD -o tun0 -i ${_interface.name} -m conntrack --ctstate NEW -j ACCEPT`,
				])
			}
		}
	}
	async forwardAll (){
		for(let [_, ports, destination, destinationPort, protocol] of config.PORTS.matchAll(/^\s*(?:((?:\d+,?)+)+>(.*?)\:(\d+)(?:\/(tcp|udp))?)/mg)){
			await this.forward({
				protocol: protocol || "tcp", 
				sourcePorts: ports.split(","), 
				destination, 
				destinationPort
			})
		}
	}
}

export let iptables = new IPTables()

export default exports