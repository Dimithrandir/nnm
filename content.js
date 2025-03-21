// make API browser agnostic
const webext = ( typeof browser === "object" ) ? browser : chrome;

// expressions to search for in the document, the first capturing group is the part to be redacted
const NWORDS = [
	// en, de, sv, da, nl, no, af
	"(noo?r(th|d)[ \-]?)ma[cksz]edon",
	// mk, bg, ru, sh
	"(сј?еверн?[аеоу][јмяйю]?[ \-]?)македон",
	// mk (latin), sh (latin), sl, cs
	"(sj?evern?[aeiouí][jm]?[ \-]?)makedon",
	// fr es it ro ast gl ca oc
	"mac[eé]d[oóôò]i?ni?[ae] (d[eou]l? n[oò]r[dt]e?)",
	// uk, be
	"(п(ів|аў)н[іо]чн[аоуі][яїйю]?[ \-]?)македон",
	// sq
	"maqedoni[aeëns]{0,2} (s?[eë] veriut)",
	// tr
	"(kuzeyd?[ie]?n?[ \-]?)makedon"
];

let gSettings = {};

// original page title as displayed on page load or after a mutation, used for more convenient style change
let titleOriginal = document.title;

/*
Get all the text nodes into a single array
*/
function getNodes(root) {
	let walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT, null, false);
	let nodes = [];
	while (node = walker.nextNode()) {
		// exclude already redacted nodes and scripts
		if (!node.parentNode.classList.contains(gSettings.redactClassName) && node.parentNode.tagName.toLowerCase() !== "script") {
			nodes.push(node);	
		}
	}
	return nodes;
}

/*
Tries to imitate Mozilla's browser extension "find" API. Searches for all the regular expressions in a given array of text nodes. Matches are stored with the indices of the nodes the match begins and ends in, and its position within those text nodes.
Searches are performed on the concatenated text content of all the nodes. By keeping each node's text content index in the concatenated text, it's possible to find the starting index of the node each match is in (using binary search for better performance). The other properties are then calculated based on the captured group length and used to define an object literal (similar to "find" API's rangeData).
Returns an array of these objects.
*/
function findMatches(nodes) {
	// array of all matches
	let result = [];
	// whole page text
	let fullText = "";
	// each node's text content starting index in fullText
	let nodesArray = [];

	// length of text content so far
	let length = 0;
	// build full text and get nodes starting indices
	for (let i = 0; i < nodes.length; i++) {
		fullText += nodes[i].textContent;
		nodesArray.push(length);
		length += nodes[i].length;
	}

	for (const nWord of NWORDS) {
		let regEx = new RegExp(nWord, "gi");
		let matches = fullText.matchAll(regEx);
		// possible multiple occurrences
		for (const match of matches) {
			// starting and ending indices of the redaction group in the full text
			let startRedact = match.index + match[0].search(match[1].trim());
			let endRedact = startRedact + match[1].trim().length;

			// ordinal position of first and last node the redaction group spans through
			let startTextNodePos = 0;
			let endTextNodePos = 0;

			// binary search the starting node index
			let l = 0;
			let r = nodesArray.length - 1;
			let m = 0;
			while (l <= r) {
				m = Math.floor((l + r) / 2);
				if (nodesArray[m] + nodes[m].textContent.length <= startRedact) {
					l = m + 1;
				}
				else if (nodesArray[m] > startRedact) {
					r = m - 1;
				}
				else {
					startTextNodePos = m;
					break;
				}
			}

			// find ending node
			endTextNodePos = startTextNodePos;
			while (endRedact > nodesArray[endTextNodePos] + nodes[endTextNodePos].textContent.length) {
				endTextNodePos++;
			}

			// find the offsets
			startOffset = startRedact - nodesArray[startTextNodePos];
			endOffset = endRedact - nodesArray[endTextNodePos];

			// insertion sort the matches
			for (let i = 0; i <= result.length; i++) {
				if (!result.length || i == result.length || startTextNodePos < result[i].startTextNodePos || startTextNodePos == result[i].startTextNodePos && startOffset <= result[i].startOffset) {
					result.splice(i, 0, {
						startTextNodePos: startTextNodePos,
						endTextNodePos: endTextNodePos,
						startOffset: startOffset,
						endOffset: endOffset,
						text: match[1].trim()});
					break;
				}
			}
		}
	}

	return result;
}

/*
Takes a text node and splits its content into three parts, the middle of them containing the redacted word of the matching text and having custom style applied.
*/
function splitNode(node, startOffset, endOffset) {

	// no need of splitting for element nodes, just insert custom style and return
	if (node.nodeType == Node.ELEMENT_NODE) {
		node.classList.add(gSettings.redactClassName);
		return;
	}

	// don't do anything if the offset values turn out to be wrong
	if (startOffset < 0 || endOffset > node.textContent.length) {
		return;
	}

	// break off a text node that begins at the match end (that will contain everything after the match)
	let postNode = node.splitText(endOffset);
	// break off a text node that begins at the match start (that will contain THE match)
	let midNode = node.splitText(startOffset);

	// create a new span node with the snapped node text content (the match)
	let newMidTextNode = document.createTextNode(midNode.textContent);
	let newMidSpanNode = document.createElement("span");
	newMidSpanNode.classList.add(gSettings.redactClassName);
	newMidSpanNode.appendChild(newMidTextNode);

	// insert it after the match text node
	node.parentNode.insertBefore(newMidSpanNode, postNode);

	// remove the original match text node
	node.parentNode.removeChild(midNode);
}

/*
For each of found matches, apply custom style to the redacted word in the matching text node of the given array of nodes. If the matching node is just a text node, splits out the matching text in a <span> element. Goes through multiple nodes if the match spans through them.
*/
function redactContent(nodes, ranges) {

	// iterate backwards through the matches (makes it easier to reference nodes with multiple matches)
	for (let i = ranges.length-1; i >= 0; i--) {
		// current match
		let range = ranges[i];

		// match is completely in one node
		if (range.startTextNodePos == range.endTextNodePos) {
			// simply get the node
			let node = nodes[range.startTextNodePos];
			// and split it at the redaction offset
			splitNode(node, range.startOffset, range.startOffset + range.text.length);
		}
		// match spans over multiple nodes
		else {
			// last node
			let lastNode = nodes[range.endTextNodePos];
			splitNode(lastNode, 0, range.endOffset);

			// iterate through all the middle nodes a match spans through. Do it backwards to keep consistency.
			for (let j = range.endTextNodePos-1; j > range.startTextNodePos; j--) {
				// current node
				let middleNode = nodes[j];
				splitNode(middleNode, 0, middleNode.textContent.length);
			}
			// first node
			let firstNode = nodes[range.startTextNodePos];
			splitNode(firstNode, range.startOffset, firstNode.textContent.length);
		}
	}
}

/*
Removes all matches of the regular expressions from the page title.
*/
function redactTitle() {

	let count = 0;

	for (const nWord of NWORDS) {
		let regEx = new RegExp(nWord, "gi");

		document.title = document.title.replaceAll(regEx, (match, p1) => {
			let redactedSection = "";
			switch(gSettings.redactClassName) {
				case "redacted-word-border":
					redactedSection = "[[" + p1.trim() + "]]";
					break;
				case "redacted-word-strike":
					redactedSection = [...p1.trim()].join("\̵");
					break;
				case "redacted-word-black":
					redactedSection = Array(p1.trim().length).fill("█").join("");
					break;
				case "redacted-word-white":
					redactedSection = Array(p1.trim().length).fill("_").join("");
					break;
				default:
					// redacted-word-hidden - redactedSection remains empty
					break;
			}
			count += 1;
			return match.replace(p1.trim(), redactedSection);
		});
	}

	return count;
}

/*
Replaces the redacting style with a new class for body elements and replaces title.
*/
function changeStyle(oldStyle, newStyle) {
	// update gSettings
	gSettings.redactClassName = newStyle;

	// get all redacted nodes
	let redactedNodes = document.getElementsByClassName(oldStyle);
	if (redactedNodes.length > 0) {
		// this is a live node list, it changes as the DOM changes, so it's best to change the first element while the list is not empty
		while (redactedNodes.length) {
			redactedNodes[0].classList.replace(oldStyle, newStyle);
		}
	}

	// change title redacting style, only if title has been redacted already and addon enabled
	if (document.title != titleOriginal && gSettings.addonEnabled && !gSettings.whitelisted) {
		document.title = titleOriginal;
		// disconnect title observer before making OUR changes
		titleObserver.disconnect();
		redactTitle();
		// continue observing title changes
		titleObserver.observe(document.head.querySelector("title"), {childList: true, subtree: true});
	}
}

function startRedacting(settings) {
	// save setting
	gSettings = settings;
	// do nothing if addon disabled or site whitelisted
	if (!settings.addonEnabled) {
		return;
	}
	else if (settings.whitelisted) {
		// send message to background to change browserAction icon for this tab (the icon set for specific tabs is reset on reload so it has to be set on load)
		webext.runtime.sendMessage({action: "set_icon"});
		return;
	}
	// all the text nodes in document
	let nodes = getNodes(document.body);
	// current site matches
	let totalCount = 0;
	// find and redact matches in page title
	totalCount += redactTitle();
	// find all the matches
	let result = findMatches(nodes);
	// update total count
	totalCount += result.length;
	// redact all the matches
	redactContent(nodes, result);
	// send new matches count to background script to be stored
	webext.runtime.sendMessage({action: "set_count", data: {count: totalCount, mutation: false}});

	return Promise.resolve();
}

// MutationObserver to watch for changes being made to the DOM, callback function starts searching and redacting on added nodes
let bodyObserver = new MutationObserver(function(mutations) {
	// do nothing if addon disabled or site whitelisted
	if (!gSettings.addonEnabled || gSettings.whitelisted) {
		return;
	}
	// get all newly added nodes
	let nodes = [];
	for (let mutation of mutations) {
		for (let node of mutation.addedNodes) {
			nodes = nodes.concat(getNodes(node));
		}
	}
	// search and redact them
	let totalCount = 0;
	let result = findMatches(nodes);
	totalCount += result.length;
	redactContent(nodes, result);
	// send new matches count (if any) to background script to be stored
	if (totalCount) {
		webext.runtime.sendMessage({action: "set_count", data: {count: totalCount, mutation: true}});
	}
});

// separate MutationObserver to watch for title changes
let titleObserver = new MutationObserver(function(mutations) {
	// do nothing if addon disabled or site whitelisted
	if (!gSettings.addonEnabled || gSettings.whitelisted) {
		return;
	}
	titleOriginal = document.title;
	// disconnect title observer before making OUR changes
	titleObserver.disconnect();
	// lookup and redact title
	redactTitle();
	// continue observing title changes
	titleObserver.observe(document.head.querySelector("title"), {childList: true, subtree: true});
});

// get settings from background script, then do initial redacting, then watch for changes
let gettingStorage = webext.runtime.sendMessage({action: "get_settings"});
gettingStorage
	.then(startRedacting)
	.then(() => {
		bodyObserver.observe(document.body, {childList: true, subtree: true});
		titleObserver.observe(document.head.querySelector("title"), {childList: true, subtree: true});
	});

// wait for a message
webext.runtime.onMessage.addListener((message) => {
	changeStyle(message.oldStyle, message.newStyle);
});
