export type IPRoute = {
	destination: string,
	gateway: string,
	mask: string,
	metric: number,
}

export type Interface = {
	name: string,
	network: string,
	address: boolean,
}

export type ContainerRoute = {
	network: string,
	destination: string,
}

export type ContainerForwardRule = {
	protocol: string,
	sourcePort: string,
	destination: string,
	destinationPort: string,
}

export type Container = {
	id: string,
	pid: string,
	name: string,
	forwarding: Array<ContainerForwardRule>
	routes: Array<ContainerRoute>,
	gatewayInterface: string
}

