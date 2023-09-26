import fs from "fs"
import process from "process"
import childProcess from "child_process"
import tmp from "tmp"

import * as log from "@/log"

export let sleep = (ms)=>{
	return new Promise(resolve => setTimeout(resolve, ms))
}

export let copy = (value)=>{
	return JSON.parse(JSON.stringify(value))
}

export let schedule = async(handler, {
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
		await worker()
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

export let exec = async(commands, options: {
	wait?: Boolean,
	log?: Boolean,
	ignore?: Boolean,
	cwd?: any,
	env?: any,
}={})=>{
	if(options.wait == undefined) options.wait = true;
	if(options.log == undefined) options.log = false;
	if(options.ignore == undefined) options.ignore = false;
	if(commands.length > 1024*10){
		// Optimization for bulk execution
		let tempFile = tmp.tmpNameSync()
		fs.writeFileSync(tempFile, `${commands}`)
		commands = `/bin/sh ${tempFile}`
	}
	let output = ""
	commands = commands.replace(/\r/g, "").split("\n").map(command=>command.trim()).filter(command=>command)
	for(let command of commands){
		let subprocess = childProcess.spawn(command, [], {
			shell: true,
			cwd: options.cwd,
			env: options.env
		})
		let callback = (data)=>{
			try{
				if(options.log){
					process.stdout.write(data.toString("utf8"))
				}
				if(options.wait && commands.length == 1 && output.length < 1024*1024*10){
					output += data.toString("utf8")
				}
			}catch(error){
				log.debug(`Failed decoding exec output`, error)
			}
		}
		subprocess.stdout.on("data", callback)
		subprocess.stderr.on("data", callback)

		if(options.wait){
			await new Promise((resolve, reject)=>{
				subprocess.on("error", reject)
				subprocess.on("close", (code)=>{
					if(code !== 0 && !options.ignore){
						reject(new Error(`${command}: exec returned code:${code}`))
					}else{
						resolve(null)
					}
				})
			})
			if(commands.length == 1){
				return output
			}
		}else{
			if(commands.length == 1){
				return subprocess
			}
		}
	}
}

export default exports