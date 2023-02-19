import os from "os"
import fs from "fs"

import * as utils from "@/utils"
import * as types from "@/types"

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

export let setNameservers = async(nameservers: Array<string>)=>{
	let data = ""
	for(let nameserver of nameservers){
		data += `nameserver ${nameserver}\n`
	}
	fs.writeFileSync("/etc/resolv.conf", data, {encoding: "utf8"})
}

export let createTunDevice = async()=>{
	try{
		await utils.exec(`\
mkdir -p /dev/net
mknod /dev/net/tun c 10 200
chmod 600 /dev/net/tun
		`, {log: false})
	}catch(error){}
}

export default exports