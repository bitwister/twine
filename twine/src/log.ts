import config from "@/config"

export let started = Number(new Date())

export class FakeError extends Error {
	stackRaw?: any;
	constructor(message: string) {
		super(message)
		let _prepareStackTrace = Error.prepareStackTrace
		Error.prepareStackTrace = (error, stack) => {
			return _prepareStackTrace(error, stack).split("\n").slice(1)
		}
		this.stackRaw = this.stack
		Error.prepareStackTrace = _prepareStackTrace
	}
}

export let formattedLogger = (type, loggingFunction)=>{
	return async(message: string, data:Object|Array<any>=null)=>{
		if(config.LOG_LEVEL != "debug" && type == "DEBUG"){
			return 
		}	

		let stackTraceLimit = Number(Error.stackTraceLimit)
		Error.stackTraceLimit = 1000
		let stack: Array<any> = (new Error()).stack as any
		Error.stackTraceLimit = stackTraceLimit

		if(typeof stack === "string"){
			stack = (stack as string).split("\n")
		}

		let origin = "unknown"
		try{
			// Travel through the callstack until we are in the log function callsite
			for(let callsite of stack){
				let _origin = String(callsite).replace(/\\/g, "/").match(/src[\/\\](.*?)\)?$/m)
				if(_origin && !_origin[1].match(/log\.ts(:\d+)?(:\d+)?$/m)){
					origin = _origin[1]
					break
				}
			}
		}catch(error){
			console.log("erro caught", error)
		}

		let date = new Date().toISOString()
		let runningTime = ((Number(new Date()) - started)/1000).toFixed(3)
		let dataEncoded = ""
		if(data instanceof Error){
			dataEncoded = String((data).stack)
		}else if(data){
			dataEncoded = JSON.stringify(data, null, 4)
		}
		let text = `[${type} ${date} ${runningTime} ${origin}] ${message} ${dataEncoded}`
		loggingFunction(text)
	}
}


export let info = formattedLogger("INFO", console.log)  
export let error = formattedLogger("ERROR", console.error) 
export let debug = formattedLogger("DEBUG", console.log) 

export default exports