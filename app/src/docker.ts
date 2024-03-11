import nodeDockerApi from "node-docker-api"
import tarStream from "tar-stream"

import * as utils from "@/utils"

export let docker 

export let init = async()=>{
	docker = new nodeDockerApi.Docker({socketPath: "/var/run/docker.sock"})
}

export let list = async(options={}): Promise<Array<any>>=>{
	return await docker.container.list(options)
}

export let exec = async(containerId, command)=>{
	command = command.replace(/\n/g, " && ").replace(/&&\s*$/m, "")
	let process = await docker.container.get(containerId).exec.create({
		AttachStdout: true,
		AttachStderr: true,
		Cmd: command.split(" ")
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

export let execNS = async(pid, command, options?): Promise<string>=>{
	return await utils.exec(`nsenter -n/host/proc/${pid}/ns/net ${command}`, options) as string
}

export let upload = async(containerId, files)=>{
	let tarArchive = tarStream.pack()
	for(let [name, data] of Object.entries(files)){
		tarArchive.entry({name, mode: 0o777}, data)
	}
	tarArchive.finalize()
	await docker.container.get(containerId).fs.put(tarArchive, {
		path: "/"
	})
}

export default exports