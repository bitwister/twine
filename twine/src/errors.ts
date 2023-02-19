import * as utils from "@/utils"

export class GenericError extends Error {
	constructor(message?: string) {
		super(message)
	}
}

export class StartupError extends GenericError { constructor(message="Startup error"){super(message)} }

export default exports