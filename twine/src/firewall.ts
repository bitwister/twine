import child_process from "child_process"

import * as utils from "@/utils"
import * as log from "@/log"
import * as types from "@/types"
import * as networking from "@/networking"
import config from "@/config"

export let init = async()=>{
	log.info(`Setting up the firewall`)
	let defaultGateway = (await utils.exec(`ip route`, {log: false})).match(/default\svia\s(.*?)\s/)[1]
	await iptables.insert([
		`-P INPUT ACCEPT`,
		`-P OUTPUT ACCEPT`,
		`-P FORWARD ACCEPT`,
		`-A INPUT -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
		`-A OUTPUT -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
		`-A FORWARD -m conntrack --ctstate NEW,ESTABLISHED,RELATED -j ACCEPT`,
		`-A INPUT -i lo -j ACCEPT`,
		`-A OUTPUT -o lo -j ACCEPT`,
		`-A FORWARD -i lo -j ACCEPT`,
		`-A INPUT -i tun+ -j ACCEPT`,
		`-A FORWARD -i tun+ -j ACCEPT`,
		`-A FORWARD -o eth+ -j ACCEPT`,
		`-A OUTPUT -o tun+ -j ACCEPT`,
		`-t nat -A POSTROUTING -o eth+ -j MASQUERADE`,
		`-t nat -A POSTROUTING -o tun+ -j MASQUERADE`,
		`-t nat -A POSTROUTING -o lo -j MASQUERADE`,
		`-A FORWARD -i tun+ -o eth+ -j ACCEPT`,
		`-A FORWARD -i eth+ -o tun+ -j ACCEPT`,
		`-A FORWARD -i eth+ -o lo+ -j ACCEPT`,
		`-A FORWARD -i lo -o eth+ -j ACCEPT`,
		`-A FORWARD -i tun+ -o eth+ -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT`,
		`-A FORWARD -i eth+ -o tun+ -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT`,
		`-A INPUT -d 10.69.0.0/24 -j ACCEPT`,
		`-A FORWARD -d 10.69.0.0/24 -j ACCEPT`,
		`-A INPUT -s ${defaultGateway} -j ACCEPT`,
		`-A FORWARD -d ${defaultGateway} -j ACCEPT`,
		`-A FORWARD -s ${defaultGateway} -j ACCEPT`,
		`-A OUTPUT -d ${defaultGateway} -j ACCEPT`,
		`-A INPUT -i tun+ -p tcp -m tcp -m multiport --dports 80,443 -j ACCEPT`,
	])
	await iptables.forwardAll()
}

export class IPTables {
	constructor(){}
	async reset(){
		await this.insert([
			"-F",
			"-X",
			`-t nat -F`,
			`-t nat -X`,
			"-P INPUT ACCEPT",
			"-P FORWARD ACCEPT",
			"-P OUTPUT ACCEPT",
		])
	}
	async check(rule){
		try{
			return !Boolean((await utils.exec(`iptables ${rule.replace(" -A ", " -C ")}`, {log: false})).trim())
		}catch(error){
			return false
		}
	}
	async insert(rules: Array<string>){
		for(let rule of rules){
			if(rule.match(/\s+\-A\s+/) && await this.check(rule)) continue;
			await utils.exec(`iptables ${rule}`, {log: false})
		}
	}
	async remove(rules){
		for(let rule of rules){
			if(!rule.match(/\s+\-A\s+/)) continue;
			await utils.exec(`iptables ${rule.replace(" -A ", " -D ")}`, {log: false})
		}
	}
	async forward({protocol="tcp", sourcePorts, destination, destinationPort}){
		await this.insert([`-t nat -A PREROUTING -i tun+ -p ${protocol} -m multiport --dports ${sourcePorts.join(",")} -j DNAT --to ${await utils.resolveIp(destination)}:${destinationPort}`])
		log.info(`Forwarded ${sourcePorts}>${destination}:${destinationPort}/${protocol}`)
	}
	async forwardAll(){
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