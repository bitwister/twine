#!/usr/bin/env node
let esbuild = require("esbuild")

module.exports.build = async()=>{
	await esbuild.build({
		entryPoints: ["./src/app.ts"],
		bundle: true,
		outfile: "./dist/app.js",
		platform: "node",
		format: "cjs",
		target: ["node14"],
		sourcemap: "inline",
		minify: false,
		plugins: [
			require("esbuild-plugin-alias-path").aliasPath({}),
		]
	})
}

if (require.main === module){
	module.exports.build()
}