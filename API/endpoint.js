const http = require('http');
const timestamp = require("console-timestamp");
const filenamify = require('filenamify');
const server = http.createServer(handler);
const authen = require('./authen.json');
const authenBrowser = require('./authenBrowser.json');
const secure = require('./secure.json');
const JSONStream = require("JSONStream");
const fetch = require("node-fetch");
const fs = require('fs-extra');
const md5 = require('md5');
const LibreTexts = require("./reuse.js");
let port = 3005;
if (process.argv.length >= 3 && parseInt(process.argv[2])) {
	port = parseInt(process.argv[2]);
}
server.listen(port);
const now1 = new Date();
console.log("Restarted " + timestamp('MM/DD hh:mm', now1));

async function handler(request, response) {
	const ip = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
	let url = request.url;
	url = url.replace("endpoint/", "");
	url = LibreTexts.clarifySubdomain(url);
	
	if (!request.headers.origin || !request.headers.origin.endsWith("libretexts.org")) {
		responseError('Unauthorized', 401);
	}
	else if (url.startsWith("/getKey")) { //moved to keys.libretexts.org
		if (request.headers.host === "computer.miniland1333.com" && request.method === "OPTIONS") { //options checking
			response.writeHead(200, {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "GET",
			});
			response.end();
		}
		else if (request.method === "GET") {
			response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "GET",
				"Content-Type": "application/json",
			} : {"Content-Type": "application/json"});
			response.write(JSON.stringify(authenBrowser));
			response.end();
		}
		else {
			responseError(request.method + " Not Acceptable", 406)
		}
	}
	else if (url.startsWith("/contents")) {
		if (request.headers.host === "computer.miniland1333.com" && request.method === "OPTIONS") { //options checking
			response.writeHead(200, {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
			});
			response.end();
		}
		else if (request.method === "PUT") {
			response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
				"Content-Type": "application/json",
			} : {"Content-Type": "application/json"});
			let body = [];
			request.on('data', (chunk) => {
				body.push(chunk);
			}).on('end', async () => {
				body = Buffer.concat(body).toString();
				
				let input = JSON.parse(body);
				//Only get requests are acceptable
				let requests = await LibreTexts.authenticatedFetch(input.path, 'contents?mode=raw', 'Cross-Library', input.subdomain);
				if (requests.ok)
					response.write(await requests.text());
				else
					responseError(`${requests.statusText}\n${await requests.text()}`, 400);
				
				response.end();
			});
		}
		else {
			responseError(request.method + " Not Acceptable", 406)
		}
	}
	else if (url.startsWith("/IIAB")) {
		if (request.headers.host === "computer.miniland1333.com" && request.method === "OPTIONS") { //options checking
			response.writeHead(200, {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
			});
			response.end();
		}
		else if (request.method === "PUT") {
			response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
				"Content-Type": "application/json",
			} : {"Content-Type": "application/json"});
			let body = [];
			request.on('data', (chunk) => {
				body.push(chunk);
			}).on('end', async () => {
				body = Buffer.concat(body).toString();
				
				let input = JSON.parse(body);
				
				if (input.key !== secure["IIAB"]) {
					responseError(`Invalid Key`, 403);
				}
				switch (input.action) {
					case 'hierarchy':
						const rootURL = input.rootURL;
						console.time(`Hierarchy: ${rootURL}`);
						response.write(JSON.stringify({url: `https://api.libretexts.org/Hierarchy/${filenamify(rootURL)}.json`}));
						response.end();
						
						let finalResult = await LibreTexts.getSubpages(rootURL, null, {
							getDetails: input.getDetails,
							getContents: input.getContents,
							delay: true
						});
						console.timeEnd(`Hierarchy: ${rootURL}`);
						
						//write subpages (and contents) to the disk
						await fs.ensureDir(`./public/Hierarchy`);
						if (!input.getContents)
							await fs.writeFile(`./public/Hierarchy/${filenamify(rootURL)}.json`, JSON.stringify([finalResult]));
						else {
							//streaming due to large filesizes
							let resultStream = JSONStream.stringify();
							let outStream = fs.createWriteStream(`./public/Hierarchy/${filenamify(rootURL)}.json`);
							resultStream.pipe(outStream);
							resultStream.write(finalResult[0]);
							let contentArray = finalResult[1];
							contentArray.forEach((item)=>resultStream.write(item));
							resultStream.end();
							// response.write(JSON.stringify(finalResult));
						}
						break;
						
					case 'contents':
					default:
						let requests = await fetch(`https://${input.subdomain}.libretexts.org/@api/deki/pages/=${encodeURIComponent(encodeURIComponent(input.path))}/contents`, {
							headers: {
								'x-deki-token': authenBrowser[input.subdomain],
								'x-requested-with': 'XMLHttpRequest',
								'origin': 'https://api.libretexts.org'
							}
						});
						if (requests.ok)
							response.write(await requests.text());
						else
							responseError(`${requests.statusText}\n${await requests.text()}`, 400);
						break;
				}
				
				if (!response.finished)
					response.end();
			});
		}
		else {
			responseError(request.method + " Not Acceptable", 406)
		}
	}
	else if (url.startsWith("/refreshList")) {
		if (request.headers.host === "computer.miniland1333.com" && request.method === "OPTIONS") { //options checking
			response.writeHead(200, {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
			});
			response.end();
		}
		else if (request.method === "PUT") {
			response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
				"Content-Type": "application/json",
			} : {"Content-Type": "application/json"});
			let body = [];
			request.on('data', (chunk) => {
				body.push(chunk);
			}).on('end', async () => {
				body = Buffer.concat(body).toString();
				
				let input = JSON.parse(body);
				console.log(input);
				if (input && input.identifier && input.identifier === md5(authenBrowser[input.subdomain])
					&& ['Courses', 'Bookshelves', 'home'].includes(input.path)) {
					await fs.ensureDir(`./public/DownloadsCenter/${input.subdomain}`);
					await fs.writeJSON(`./public/DownloadsCenter/${input.subdomain}/${filenamify(input.path)}.json`, input.content);
				}
				else {
					responseError(`Bad Request\nRejected path ${input.path}`, 400)
				}
				
				response.end();
			});
		}
		else {
			responseError(request.method + " Not Acceptable", 406)
		}
	}
	else if (url === "/subpages" && false) { // disabled
		if (request.headers.host.includes(".miniland1333.com") && request.method === "OPTIONS") { //options checking
			response.writeHead(200, {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
				"Content-Type": " application/json",
			});
			response.end();
		}
		else if (request.method === "PUT") {
			response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
				"Content-Type": " application/json",
			} : {"Content-Type": " application/json"});
			let body = [];
			request.on('data', (chunk) => {
				body.push(chunk);
			}).on('end', async () => {
				body = Buffer.concat(body).toString();
				
				let input = JSON.parse(body);
				const username = input.username;
				const rootURL = input.rootURL;
				console.time(`Subpages: ${rootURL}`);
				let finalResult = await LibreTexts.getSubpages(rootURL, username, {getDetails: true, delay: true});
				console.timeEnd(`Subpages: ${rootURL}`);
				response.write(JSON.stringify(finalResult));
				response.end();
			});
		}
	}
	else if (url.startsWith("/getAuthors/")) {
		if (request.headers.host.includes(".miniland1333.com") && request.method === "OPTIONS") { //options checking
			response.writeHead(200, {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "GET",
				"Content-Type": " application/json",
				"Cache-Control": "public, max-age=36000",
			});
			response.end();
		}
		else if (request.method === "GET") {
			response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
				"Access-Control-Allow-Origin": request.headers.origin || null,
				"Access-Control-Allow-Methods": "PUT",
				"Content-Type": " application/json",
				"Cache-Control": "public, max-age=36000",
			} : {"Content-Type": " application/json", "Cache-Control": "public, max-age=36000",});
			
			let subdomain = url.split('/getAuthors/')[1];
			let contents = await LibreTexts.authenticatedFetch('Template:Custom/Views/ContentHeader/LibrarySpecific', 'contents', subdomain, authen["getAuthors"]);
			if (contents.ok) {
				contents = await contents.text();
				let match = contents.match(/^var authors = {[\s\S]*?^}/m);
				if (match) {
					contents = match[0];
					contents = contents.replace('var authors = ', '');
					contents = LibreTexts.decodeHTML(contents);
					contents = LibreTexts.decodeHTML(contents);
					response.write(contents);
				}
			}
			response.end();
		}
	}
	else {
		responseError('Action not found', 400);
	}
	
	
	function responseError(message, status) {
		//else fall through to error
		response.writeHead(status ? status : 400, {"Content-Type": "text/html"});
		response.write(("Bad Request\n" + (message ? message : url)));
		response.end();
	}
}