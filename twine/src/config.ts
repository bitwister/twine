import process from "process"
import uuidv4 from "uuid/v4"

export default {
	LOG_LEVEL: {
		debug: "debug",
		info: "info"
	}[(process.env.LOG_LEVEL || "info").toLowerCase()] || "info", 
	DEV: Boolean(process.env.DEV || false),
	PORTS: process.env.PORTS || "",
	PROTOCOL: (process.env.PROTOCOL || "openvpn").toLowerCase(),
	MODE: (process.env.MODE || "server").toLowerCase()
}