const http = require('http');
const timestamp = require("console-timestamp");
const EPub = require("epub");
const filenamify = require('filenamify');
const server = http.createServer(handler);
const authen = require('./authen.json');
const fs = require('fs-extra');
const {performance} = require('perf_hooks');
const fetch = require("node-fetch");
const download = require('download');
const async = require('async');
const util = require('util');
const Eta = require('node-eta');
let port = 3003;
if (process.argv.length >= 3 && parseInt(process.argv[2])) {
	port = parseInt(process.argv[2]);
}
server.listen(port);
const now1 = new Date();
console.log("Restarted " + timestamp('MM/DD hh:mm', now1));
console.log(now1.toString());

const mapLimit = util.promisify(async.mapLimit);
const map = util.promisify(async.map);

function handler(request, response) {
	const ip = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
	let url = request.url;

	if (url.startsWith("/import")) {
		if (request.headers.origin && request.headers.origin.endsWith("libretexts.org")) {
			if (request.headers.host.includes(".miniland1333.com") && request.method === "OPTIONS") { //options checking
				response.writeHead(200, {
					"Access-Control-Allow-Origin": request.headers.origin,
					"Access-Control-Allow-Methods": "POST",
					"Content-Type": " application/json",
				});
				response.end();
			}
			else if (request.method === "POST") {
				response.writeHead(200, request.headers.host.includes(".miniland1333.com") ? {
					"Access-Control-Allow-Origin": request.headers.origin,
					"Access-Control-Allow-Methods": "POST",
					"Content-Type": " application/json",
				} : {"Content-Type": " application/json"});
				let body = [];
				request.on('data', (chunk) => {
					body.push(chunk);
				}).on('end', async () => {
					body = Buffer.concat(body).toString();

					let input = JSON.parse(body);
					if (!(input.url && input.url.match(/^(http|https):\/\//))) {
						reportMessage('This source is not valid, please check your URL', true);
						response.end();
					}
					else {
						const subdomain = request.headers.origin.split("/")[2].split(".")[0];
						input.url = input.url.replace(/\/$/, "");
						console.log(input.url);
						processEPUB(input.url, subdomain, input.user).then();
					}
				});
			}
			else {
				responseError(request.method + " Not Acceptable", 406)
			}
		}
	}

	function responseError(message, status) {
		//else fall through to error
		response.writeHead(status ? status : 400, {"Content-Type": "text/html"});
		response.write(("Bad Request\n" + (message ? message : url)));
		response.end();
	}

	function reportMessage(message, isError) {
		if (isError) {
			console.error(message);
		}
		else {
			console.log(message);
		}
		let json = {
			message: message,
			isError: isError,
		};
		response.write(JSON.stringify(json) + "\r\n");
	}

	async function processEPUB(target, subdomain, user) {
		const start = performance.now();
		reportMessage('Downloading...This will take quite a while...');
		let checkURL = await fetch(target + '/open/download?type=epub', {
			method: 'HEAD'
		});
		if (!checkURL.ok) {
			reportMessage('This source is not valid, please check your URL', true);
			response.end();
			return false;
		}

		let data = await download(target + '/open/download?type=epub');
		let epubName = `epubs/${filenamify(target)}.epub`;
		await fs.ensureDir('epubs');
		await fs.writeFile(epubName, data);
		reportMessage('EPUB download complete. Processing...');

		let epub = new EPub(epubName);
		epub.on("end", async function () {
			const title = epub.metadata.title;
			let filtered = [];
			let chapters = [];
			const toc = epub.toc;
			let chapterIndex = 0;
			let pageIndex = 1;

			for (let i = 0; i < toc.length; i++) {
				if (toc[i].href.includes('-slug-') || toc[i].level) {
					//front and back matter ignored
					let page = toc[i];
					let indexes = page.title.match(/^[0-9.]+/);
					if (indexes) {
						indexes = indexes[0];
						page.title = page.title.replace(indexes, indexes + ':');
					}
					else {
						page.title = `${chapterIndex}.${pageIndex}: ${page.title}`;
					}
					pageIndex++;
					filtered.push({title: page.title, id: page.id});
				}
				else if (toc[i].href.includes('-chapter-') || toc[i].href.includes('part-')) {
					chapters.push({title: toc[i].title, id: toc[i].id});
					chapterIndex++;
					pageIndex = 1;
				}
			}

			let filteredChapters = [];
			for (let i = 0; i < chapters.length; i++) {
				let current = chapters[i];
				if (!current.title.includes('Summary'))
					filteredChapters.push(current);
			}

			let root = 'https://chem.libretexts.org/Under_Construction/Users/Henry/dev/' + title;
			let subroot = 'Under_Construction/Users/Henry/dev/' + title;
			if (await coverPage(subroot)) {
				await processChapters(root, subroot, filteredChapters);
				await processPages(filtered, root, subroot, filteredChapters);

				const end = performance.now();
				let time = end - start;
				time /= 100;
				time = Math.round(time);
				time /= 10;

				reportMessage(`Upload ${title} complete!`);
				reportMessage({
					messageType: "complete",
					timeTaken: time,
					resultURL: subroot,
				});
			}
			else {
				reportMessage('Page already exists!', true);
			}
			response.end()
		});
		epub.parse();

		async function coverPage(subroot) {
			const token = authenticate(user, subdomain);
			let content = "<p>{{template.ShowCategory()}}</p>";
			// TODO Reenable ?abort=exists
			let response = await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(subroot)) + "/contents?edittime=now", {
				method: "POST",
				body: content,
				headers: {'x-deki-token': token}
			});
			if (!response.ok) {
				let error = await response.text();
				reportMessage(error, true);
				return false;
			}
			let tags = '<tags><tag value="article:topic-category"/><tag value="coverpage:yes"/></tags>';
			let propertyArray = [putProperty('mindtouch.page#welcomeHidden', true, subroot), putProperty('mindtouch.idf#subpageListing', 'simple', subroot), fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(subroot)) + "/tags", {
				method: "PUT",
				body: tags,
				headers: {"Content-Type": "text/xml; charset=utf-8", 'x-deki-token': token}
			})];

			await Promise.all(propertyArray);
			return true;
		}

		async function processChapters(root, subroot, chapters) {
			let promiseArray = [];

			for (let i = 0; i < chapters.length; i++) {
				promiseArray.push(processChapter(i));
			}
			await Promise.all(promiseArray);

			async function processChapter(index) {
				const token = authenticate(user, subdomain);
				let title = chapters[index].title;
				title = title.replace("Chapter ", "");
				let number = title.match(/[0-9]+(?= )/);
				if (number) {
					number = number[0];
				}
				else {
					number = index + 1;
					if (!title.startsWith(`${index + 1}:`))
						title = `${index + 1}: ${title}`;
				}
				let padded = title.replace(number, ("" + number).padStart(2, "0"));
				chapters[index].title = title;
				chapters[index].padded = padded;
				let location = `${subroot}/${title}`;
				let content = "<p>{{template.ShowGuide()}}</p>";
				let response = await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(location)) + "/contents?edittime=now", {
					method: "POST",
					body: content,
					headers: {'x-deki-token': token}
				});
				if (!response.ok) {
					let error = await response.text();
					reportMessage(error, true);
					return false;
				}
				else {
					let href = await response.text();
					href = href.match(/(?<=<uri.ui>).*?(?=<\/uri.ui>)/)[0];
					console.log('Chapter ' + href);
				}

				let tags = '<tags><tag value="article:topic-guide"/></tags>';
				if (padded !== title) {
					let response = await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(location)) + "/move?title=" + encodeURIComponent(title) + "&name=" + encodeURIComponent(padded), {
						method: "POST",
						headers: {'x-deki-token': token}
					});
					if (!response.ok) {
						let error = await response.text();
						reportMessage(error, true);
					}
					else {
						// reportMessage(await response.text());
					}
				}

				await Promise.all(
					[putProperty("mindtouch.idf#guideDisplay", "single", location),
						putProperty('mindtouch.page#welcomeHidden', true, location),
						putProperty("mindtouch#idf.guideTabs", "[{\"templateKey\":\"Topic_hierarchy\",\"templateTitle\":\"Topic hierarchy\",\"templatePath\":\"MindTouch/IDF3/Views/Topic_hierarchy\",\"guid\":\"fc488b5c-f7e1-1cad-1a9a-343d5c8641f5\"}]", location),
						fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(location)) + "/tags", {
							method: "PUT",
							body: tags,
							headers: {"Content-Type": "text/xml; charset=utf-8", 'x-deki-token': token}
						})]);
				return true;
			}
		}

		async function processPages(splice, root, subroot, filteredChapters) {
			let completed = 0;
			const eta = new Eta(splice.length, true);

			async function processPage(page) {
				const token = authenticate(user, subdomain);
				epub.getChapterRaw = util.promisify(epub.getChapterRaw);
				epub.getImage = util.promisify(epub.getImage);
				let content = await epub.getChapterRaw(page.id);
				content = content.match(/(?<=class="ugc.*>)[\s\S]*?(?=<\/div>\n+<\/div>)/m)[0];


				let path = page.title;
				let chapterNumber = parseInt(path.match(/.*?(?=\.)/)[0]);
				let padded = chapterNumber < 10 ? "0" + path : false;
				path = `${subroot}/${filteredChapters[chapterNumber - 1].padded}/${path}`;

				//remove extraneous link tags
				let containerTags = content.match(/<a>\n\s*?<img [\s\S]*?<\/a>/gm);
				if (containerTags) {
					for (let i = 0; i < containerTags.length; i++) {
						let toReplace = containerTags[i].match(/<img.*?"\/>/)[0];
						content = content.replace(containerTags[i], toReplace);
					}
				}

				//Rewrite image src url
				let images = content.match(/<img .*?src="assets\/.*?\/>/g);
				let src = content.match(/(?<=<img .*?src="assets\/).*?(?=")/g);
				if (src) {
					for (let i = 0; i < src.length; i++) {
						const fileID = await uploadImage(src[i]);
						let toReplace = images[i].replace("assets/", `/@api/deki/files/${fileID}/`);
						content = content.replace(images[i], toReplace);
					}
				}

				await uploadContent();
				completed++;
				eta.iterate();
				reportMessage({
					messageType: "progress",
					percent: (Math.round(completed / splice.length * 1000) / 10),
					eta: eta.format("{{etah}}"),
					// count: count,
				});


				//Function Zone
				async function uploadContent() {
					let url = `https://${subdomain}.libretexts.org/@api/deki/pages/=${encodeURIComponent(encodeURIComponent(path))}/contents?edittime=now`;
					let response = await fetch(url, {
						method: 'POST',
						body: content,
						headers: {'x-deki-token': token}
					});
					if (response.ok) {
						let href = await response.text();
						href = href.match(/(?<=<uri.ui>).*?(?=<\/uri.ui>)/)[0];
						console.log(href);
					}
					else {
						let error = await response.text();
						reportMessage(error, true);
					}

					await putProperty('mindtouch.page#welcomeHidden', true, path);
					if (padded) {
						let response = await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(path)) + "/move?title=" + encodeURIComponent(page.title) + "&name=" + encodeURIComponent(padded), {
							method: "POST",
							headers: {'x-deki-token': token}
						});
						if (!response.ok) {
							let error = await response.text();
							reportMessage(error, true);
						}
						else {
							// reportMessage(await response.text());
						}
					}
					let tags = '<tags><tag value="article:topic"/></tags>';
					await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(path)) + "/tags", {
						method: "PUT",
						body: tags,
						headers: {"Content-Type": "text/xml; charset=utf-8", 'x-deki-token': token}
					});
				}

				async function uploadImage(filename) {
					let manifestID = filename.replace(/\.[^/.]+$/, ''); //remove extension
					manifestID = 'media-' + manifestID.replace(/[^a-z0-9\-]/gi, ''); //only alphanumeric
					let image = await epub.getImage(manifestID);
					if (!image) {
						reportMessage(manifestID, true);
						return false;
					}
					let response = await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=${encodeURIComponent(encodeURIComponent(path))}/files/${encodeURIComponent(encodeURIComponent(filename))}`, {
						method: 'PUT',
						body: image,
						headers: {'x-deki-token': token}
					});
					if (response.ok) {
						let fileID = await response.text();
						fileID = fileID.match(/(?<=<file id=").*?(?=")/)[0];
						return fileID;
					}
					else {
						let error = await response.text();
						reportMessage(error, true);
					}
				}
			}

			return await mapLimit(splice, 5, processPage);
		}

		async function putProperty(name, value, path) {
			const token = authenticate(user, subdomain);
			await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=` + encodeURIComponent(encodeURIComponent(path)) + "/properties", {
				method: "POST",
				body: value,
				headers: {"Slug": name, 'x-deki-token': token}
			})
		}
	}
}

async function main() {
	//https://opentextbc.ca/geology/open/download?type=xhtml
	// let target = 'https://opentextbc.ca/geology/';
	// let target = 'https://ohiostate.pressbooks.pub/sciencebites/';
	let target = 'http://pressbooks.oer.hawaii.edu/humannutrition/';
	target = target.replace(/\/$/, "");
	await processEPUB(target);

	/*	let response = await fetch(target + '/open/download?type=xhtml');
		if (response.ok) {
			await processXHTML(await response.text());
		}
		else {
			console.log("Cannot get xhtml for this book!\nFalling back to EPUB.");
			await processXHTML(await response.text());
		}*/
}

/*

async function processXHTML(text) {
	let title = getProperty("title");
	let copyright = getProperty("book-license");
	let author = getProperty("authors");
	let coverImage = getProperty("cover-image");

	let splice = text.match(/<div .*?\n^<\/div>/gm);
	let filtered = [];
	for (let i = 0; i < splice.length; i++) {
		if (splice[i].startsWith("<div class=\"chapter")) {
			//front and back matter ignored
			filtered.push(splice[i]);
		}
	}
	let root = `https://${subdomain}.libretexts.org/Under_Construction/Users/Henry/${title}`;
	let contentArray = await processPages(filtered, root);
	reportMessage(contentArray);

	function getProperty(property) {
		let regex = new RegExp(`(?<=<meta name="pb-${property}" content=).*(?=" \\/>)`);
		let result = text.match(regex);
		return result ? result[0] : null;
	}

	async function processPages(splice, root) {
		async function processPage(page) {
			let title = page.match(/(?<=<div class=".*?-title-wrap">.*?-title">).*?(?=<.*?<\/div>)/)[0];
			let content = page.match(/(?<=<div class=".*?-title-wrap">.*?<\/div><.*?>).*(?=<\/div)/)[0];
			let sourceImages = page.match(/(?<=<img .*src=").*?(?=")/g);
			let filenames = sourceImages.map((image) => {
				return image.match(/[^/]+(?=\/$|$)/)[0];
			});
			let path = "";

			for (let i = 0; i < content.length; i++) {
				let regex = new RegExp(`(?<=<img .*src=")${sourceImages[i]}(?=")`);
				content = content.replace(regex, `${root}${path}/${filenames[i]}`)
			}

			return {title: title, content: content, sourceImages: sourceImages, filenames};
		}

		return await mapLimit(splice, 10, processPage);
	}
}

async function photoTest() {
	const token = authenticate("Hank", subdomain);
	let target = "https://opentextbc.ca/geology/wp-content/uploads/sites/110/2016/07/Geologists-examining-ash-layer-1024x585.jpg";
	let path = 'Under_Construction/Users/Henry/PreTeXt_and_Pressbooks_Import/I' + Math.floor(Math.random() * 1000);
	let filename = target.match(/[^/]+(?=\/$|$)/)[0];
	let image = await fetch(target);
	image = await image.blob();

	let response = await fetch(`https://${subdomain}.libretexts.org/@api/deki/pages/=${encodeURIComponent(encodeURIComponent(path))}/files/${encodeURIComponent(encodeURIComponent(filename))}`, {
		method: 'PUT',
		body: image,
		headers: {'x-deki-token': token}
	});
	if (response.ok)
		reportMessage(`https://${subdomain}.libretexts.org/${path}`);
}
*/

function authenticate(username, subdomain) {
	const user = "=" + username;
	const crypto = require('crypto');
	const hmac = crypto.createHmac('sha256', authen[subdomain].secret);
	const epoch = Math.floor(Date.now() / 1000);
	hmac.update(`${authen[subdomain].key}${epoch}${user}`);
	const hash = hmac.digest('hex');
	return `${authen[subdomain].key}_${epoch}_${user}_${hash}`;
}
