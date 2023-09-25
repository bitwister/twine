import process from "process"

export default {
	LOG_LEVEL: {
		debug: "debug",
		info: "info"
	}[(process.env.LOG_LEVEL || "info").toLowerCase()] || "info", 
	DEV: Boolean(process.env.DEV || false),
}