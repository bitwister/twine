import fs from "fs"
import process from "process"
import childProcess from "child_process"
import dns from "dns"
import dnsLookupCache from "dns-lookup-cache"
import tmp from "tmp"

import * as log from "@/log"
import * as types from "@/types"
import * as errors from "@/errors"
import config from "@/config"

export let sleep = (ms)=>{
	return new Promise(resolve => setTimeout(resolve, ms))
}

export let copy = (value)=>{
	return JSON.parse(JSON.stringify(value))
}

export let resolveIp = async(hostname)=>{
	return await new Promise((resolve, reject)=>{
		dnsLookupCache.lookup(hostname, {family: 4}, (error, address)=>{ 
		// dns.lookup(hostname, {family: 4}, (error, address)=>{
			if(error || !address){
				reject(error || new Error("Could not resolve ipv4"))
			}else{
				resolve(address)
			}
		})
	})
}

export let schedule = (handler, {
	every=1000*60, 
	immediate=true
})=>{
	let canceled
	let worker = (async()=>{
		try{
			await handler()
		}catch(error){
			log.error(`Error occurred while running a scheduled task`, error)
		}
		if(!canceled) setTimeout(worker, every)
	})
	if(immediate){
		worker()
	}else{
		setTimeout(worker, every)
	}
	return ()=>{
		canceled = true
	}
}

export let wait = async(condition, {timeout=240000, interval=1000}={})=>{
	for(let i=0; i<=Math.round(timeout/interval); i++){
		if( await condition() ) return
		await sleep(interval)
	}
}

export let exec = async(commands, options:any={})=>{
	if(options.wait === undefined) options.wait = true;
	if(options.log === undefined) options.log = true;
	if(commands.length > 1024*10){
		// Optimization for bulk execution
		let tempFile = tmp.tmpNameSync()
		fs.writeFileSync(tempFile, `${commands}`)
		commands = `/bin/sh ${tempFile}`
	}
	let output = ""
	commands = commands.split("\n")
	for(let command of commands){
		command = command.trim()
		if(!command) continue;
		let subprocess = childProcess.spawn(command.split(" ")[0], command.split(" ").slice(1), options)
		let callback = (pipe, data)=>{
			try{
				if(options.log){
					process[pipe].write(data.toString("utf8"))
				}
				if(options.wait && commands.length == 1 && output.length < 1024*1024*10){
					output += data.toString("utf8")
				}
			}catch(error){
				log.debug(`Failed decoding exec output`, error)
			}
		}
		subprocess.stdout.on("data", data=>callback("stdout", data))
		subprocess.stderr.on("data", data=>callback("stderr", data))

		if(options.wait){
			await new Promise((resolve, reject)=>{
				subprocess.on("error", reject)
				subprocess.on("close", (code)=>{
					if(code !== 0 && !options.ignoreCode){
						reject(new errors.GenericError(`${command}: exec returned code:${code}`))
					}else{
						resolve(0)
					}
				})
			})
		}else{
			if(commands.length == 1){
				return subprocess
			}
		}
	}
}

export let parseDockerTwineLabels = (labels)=>{
	let output = {
		routes: []
	}
	for(let [key, value] of Object.entries(labels) as Array<[string, string]>){
		if(key == "twine.routes"){
			for(let [_, network, destination] of value.matchAll(/(\d+\.\d+\.\d+\.\d+\/\d+|default)\>([^\s]+)/g)){
				output.routes.push({
					network,
					destination,
				})
			}
		}
	}
	return output
}

export default exports