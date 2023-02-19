import uuidv4 from "uuid/v4"
import moment from "moment"

import * as utils from "@/utils"
import config from "@/config"

export type Interface = {
	name: string
	network: string
	address: boolean
}

export type ContainerLock = {
	owner: string,
	created: number,
	updated: number,
	ttl: number
}

export type ContainerRoute = {
	network: string, 
	destination: string
	destinationIp?: string
}

export type Container = {
	id: string,
	routes: Array<ContainerRoute>,
	lock?: ContainerLock
}

export enum Mode {
	Client = "client",
	Server = "server"
}

export default exports