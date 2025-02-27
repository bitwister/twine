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

export type ContainerPortForwardRule = {
	interface: string,
	protocol: string,
	sourcePort: string,
	destination: string,
	destinationPort: string,
}

export type Container = {
	id: string,
	pid: string,
	name: string,
	iptables: {
		customRules: {[name: string]: string}
	},
	nat: {
		interfaces: Array<string>,
		portForwarding: Array<ContainerPortForwardRule>,
	}
	host: {
		routes: Array<string>,
	}
	routes: Array<ContainerRoute>,
}

