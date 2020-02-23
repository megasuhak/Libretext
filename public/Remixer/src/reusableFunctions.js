let RemixerFunctions = {
	generateDefault: generateDefault,
	userPermissions: userPermissions,
	statusColor: statusColor,
	articleTypeToTitle: articleTypeToTitle,
	getSubpages: getSubpages,
	ReRemixTree: ReRemixTree,
};

function generateDefault(chapters, pages) {
	let key = 1;
	let children = [];
	for (let i = 1; i <= chapters; i++) {
		let childPages = [];
		let chapterKey = key++;
		
		for (let j = 1; j <= pages; j++) {
			childPages.push({
				expanded: true,
				key: `_${key++}`,
				lazy: false,
				title: `${i}.${j}: New Page`,
				data: {
					id: -1,
					status: 'new',
					padded: `${i.toString().padStart(2, '0')}.${j.toString().padStart(2, '0')}: New Page`
				}
			})
		}
		
		children.push({
			expanded: true,
			key: `_${chapterKey}`,
			lazy: false,
			title: `${i}: Untitled Chapter ${i}`,
			data: {id: -1, status: 'new', "padded": `${i.toString().padStart(2, '0')}: Chapter ${i}`},
			children: childPages
		})
	}
	
	return {
		title: "New Untitled Remix",
		key: "ROOT",
		url: "",
		data: {
			padded: "",
			status: 'new',
			articleType: 'topic-category',
			tags: ['coverpage:yes']
		},
		unselectable: true,
		expanded: true,
		children: children,
	}
}

function userPermissions(full) {
	
	let permission = 'Demonstration';
	const isAdmin = document.getElementById('adminHolder').innerText === 'true';
	const isPro = document.getElementById('proHolder').innerText === 'true';
	const groups = document.getElementById('groupHolder').innerText.toLowerCase();
	
	if (isAdmin)
		permission = "Admin";
	else if (isPro && groups.includes('reremixer'))
		permission = 'Pro';
	else if (isPro && groups.includes('faculty'))
		permission = 'Faculty';
/*	else if (groups.includes('workshop'))
		permission = 'Workshop';*/
	else if (isPro && (groups.includes('basicuser') || groups.includes('workshop')))
		permission = 'Basic';
	
	const colors = {
		Admin: '#323232',
		Pro: '#9c27b0',
		Faculty: '#0f67a6',
		Basic: '#c38323',
		Demonstration: '#767676',
	};
	const descriptions = {
		Admin: 'Administrators have full access to the Remixer, including the ReRemixer',
		Pro: 'Pro users are given permission to use the Remixer and ReRemixer',
		Faculty: 'Registered Faculty can use the Remixer',
		Basic: 'Basic users can work on Remixes in their sandbox',
		Demonstration: 'In Demonstration mode, the Remixer is functional but users cannot publish their end result to LibreTexts. Contact info@libretexts.org if you are a faculty member who is interested in publishing their own Remix!',
	};
	
	if (!full)
		return permission;
	else
		return {permission: permission, color: colors[permission], description: descriptions[permission]}
}


function statusColor(status) {
	switch (status) {
		case 'unchanged':
			return 'gray';
		case 'new':
			return 'green';
		case 'modified':
			return 'orange';
		case 'deleted':
			return 'red';
		default:
			return status;
	}
}


function articleTypeToTitle(type) {
	switch (type) {
		case 'topic-category':
			return 'Unit';
		case 'topic-guide':
			return 'Chapter';
		case 'topic':
			return 'Topic';
	}
}

function ReRemixTree(current, rootPath) {
	if (current) {
		if (!current.data) {
			current.data = {};
			for (let key in current) {
				if (!current.hasOwnProperty(key))
					continue;
				//keys that are handled by fancytree
				if (!['key', 'extraClasses', 'expanded', 'lazy', 'title', 'data', 'children'].includes(key)) {
					current.data[key] = current[key];
					delete current[key];
				}
			}
		}
		current.title = current.title.replace(/<a.*?<\/a>/, '');
		current.data.relativePath = current.data.path.replace(rootPath, '');
		current.original = {title: current.title, data: JSON.parse(JSON.stringify(current.data))};
		current.status = 'unchanged';
		delete current.lazy;
		if (current.children && current.children.length) {
			current.children.forEach((child) => {
				ReRemixTree(child, current.data.path);
			});
		}
	}
}

async function getSubpages(path, subdomain, options = {
	includeMatter: false,
	linkTitle: false,
	full: false
}) {
	path = path.replace(`https://${subdomain}.libretexts.org/`, '');
	let response = await LibreTexts.authenticatedFetch(path, 'subpages?dream.out.format=json', subdomain);
	response = await response.json();
	return await subpageCallback(response);
	
	async function subpageCallback(info) {
		let subpageArray = info['page.subpage'];
		if (subpageArray) {
			subpageArray = subpageArray.length ? info['page.subpage'] : [info['page.subpage']];
		}
		const result = [];
		const promiseArray = [];
		
		async function subpage(subpage, index) {
			let url = subpage['uri.ui'];
			let path = subpage.path['#text'];
			url = url.replace('?title=', '');
			path = path.replace('?title=', '');
			const hasChildren = subpage['@subpages'] === 'true';
			let children = hasChildren ? undefined : [];
			if (hasChildren && options.full) { //recurse down
				children = await LibreTexts.authenticatedFetch(path, 'subpages?dream.out.format=json', subdomain);
				children = await children.json();
				children = await subpageCallback(children);
			}
			if (!url.endsWith('/link') && (options.includeMatter || (subpage.title !== 'Front Matter' && subpage.title !== 'Back Matter'))) {
				let miniResult = {
					title: options.linkTitle ? `${subpage.title}<a href="${url}" target="_blank"><span class="mt-icon-link" style="font-size: 90%; margin-left: 5px"></a>` : subpage.title,
					url: url,
					sourceURL: url,
					path: path,
					children: children,
					lazy: !options.full && hasChildren,
					status: 'new',
				};
				miniResult = await LibreTexts.getAPI(miniResult);
				
				let type = miniResult.tags.find(elem => elem.startsWith('article:'));
				if (type) {
					miniResult.articleType = type.split('article:')[1];
					miniResult.extraClasses = `article-${miniResult.articleType}`;
				}
				miniResult.tags = miniResult.tags.filter(elem => !elem.startsWith('article:'));
				result[index] = miniResult;
			}
		}
		
		if (subpageArray && subpageArray.length) {
			for (let i = 0; i < subpageArray.length; i++) {
				promiseArray[i] = subpage(subpageArray[i], i);
			}
			
			await Promise.all(promiseArray);
			return result.filter(elem => elem);
		}
		else {
			return [];
		}
	}
}

module.exports = RemixerFunctions;