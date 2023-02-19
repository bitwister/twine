import fs from "fs"
import process from "process"
import nodeDockerApi from "node-docker-api"
import crypto from "crypto"
import {EventEmitter} from "events"
import tarStream from "tar-stream"

import * as utils from "@/utils"
import * as types from "@/types"

export let events = new EventEmitter()
export let on = events.on.bind(events)
export let docker 

export let init = async()=>{
	docker = new nodeDockerApi.Docker({socketPath: "/var/run/docker.sock"})
	docker.events({})
		.then(stream=>{
			stream.on("data", (data)=>{
				let event = JSON.parse(data.toString())
				if(event.Type == "container" && ["restart", "start", "stop", "update"].indexOf(event.Action) != -1){
					let container: types.Container = {
						id:	event.Actor.ID,
						routes: utils.parseDockerTwineLabels(event.Actor.Attributes).routes
					}
					events.emit("containerUpdate", container)
				}
			})
		})
}

export let list = async(options={}): Promise<Array<any>>=>{
	return await docker.container.list(options)
}

export let exec = async(containerId, command)=>{
	command = command.replace(/\n/g, " && ").replace(/&&\s*$/m, "")
	let process = await docker.container.get(containerId).exec.create({
		AttachStdout: true,
		AttachStderr: true,
		Cmd: ["/bin/sh", "-c", command]
	})
	let stream = await process.start({ Detach: false })
	let output = ""
	await new Promise((resolve, reject) => {
		stream.on("data", (data) => output += data.toString("utf8"))
		stream.on("error", reject)
		stream.on("end", resolve);
	})
	return output
}

export let upload = async(containerId, files)=>{
	let tarArchive = tarStream.pack()
	for(let [name, data] of Object.entries(files)){
		tarArchive.entry({name}, data)
	}
	tarArchive.finalize()
	await docker.container.get(containerId).fs.put(tarArchive, {
		path: "/"
	})
}


export default exports