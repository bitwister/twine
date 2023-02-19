import fs from "fs"
import uuidv4 from "uuid/v4"
import crypto from "crypto"
import process from "process"
import neodoc from "neodoc"
import moment from "moment"

import * as types from "@/types"
import * as errors from "@/errors"
import * as utils from "@/utils"
import * as log from "@/log"

import * as firewall from "@/firewall"
import * as networking from "@/networking"
import * as protocols from "@/protocols"
import * as docker from "@/docker"
import * as workers from "@/workers"

import config from "@/config"


let doc = `
Usage:
	twine start 
	twine cleanup
	twine openvpn-add <username>
	twine openvpn-revoke <username>

Options:
	-h, --help 
`.replace(/\t/g, " ".repeat(4))

process.on("unhandledRejection", (reason, promise) => {
	if(config.LOG_LEVEL == "debug"){
		console.error(reason)
	}
	log.debug("UnhandledRejection:", reason)
})

export let cleanup = async()=>{
	// TODO
}

async function init(){

	let options = neodoc.run(doc)

	let Protocol = protocols.protocols[config.PROTOCOL]
	if(!Protocol){
		throw new errors.StartupError(`Unsupported PROTOCOL=${config.PROTOCOL}`)
	}
	let protocol = new Protocol()

	if(options["start"]){
		await docker.init()
		
		let networkWorker = new workers.NetworkWorker()

		process.once("SIGTERM", cleanup)
		process.once("SIGINT", cleanup)

		await firewall.iptables.reset()
		await networking.createTunDevice()
		await networking.setNameservers(["127.0.0.11", "1.1.1.1"])
		await protocol.setup()
		await firewall.init()
		await networkWorker.start()
		
		docker.on("containerUpdate", async(container: types.Container)=>{
			await networkWorker.manage(container)
		})

		log.info("Ready")

		if(config.MODE == types.Mode.Client){
			await protocol.startClient()
		}

		if(config.MODE == types.Mode.Server){
			await protocol.startServer()
		}

		await cleanup()
		await networkWorker.stop()
	}

	if(options["cleanup"]){
		await docker.init()
		await cleanup()
	}

	if(options["openvpn-add"]){
		await protocol.usersCreate(options["<username>"])
	}

	if(options["openvpn-revoke"]){
		await protocol.usersDelete(options["<username>"])
	}

	process.exit(0)
}

init().catch(console.error)

