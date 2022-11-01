// make API browser agnostic
const webext = ( typeof browser === "object" ) ? browser : chrome;

// each object contains the word or phase to find in the document, and the part of it to be redacted
const NWORDS = [
	{
		query: "north macedonia",
		redactedWord: "north"
	},
	{
		query: "северна македонија",
		redactedWord: "северна"
	},
	{
		query: "северна македония",
		redactedWord: "северна"
	},
	{
		query: "severna makedonija",
		redactedWord: "severna"
	},
	{
		query: "sjeverna makedonija",
		redactedWord: "sjeverna"
	},
	{
		query: "nordmazedoni",
		redactedWord: "nord"
	},
	{
		query: "kuzey makedonya",
		redactedWord: "kuzey"
	}
	/*
	{
		query: "maqedonisë së veriut",
		redactedWord: "së veriut"
	}
	*/
];

let gSettings = {};

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
Tries to imitate Mozilla's browser extension "find" API. Looks up a given string in an array of text nodes. Matches are stored with the indices of the nodes the lookup word begins and ends in, and the position within those text nodes. 
For each text node, searches the given text within it at first. Then searches substructing substrings of it at the end of the node. If a match if found, it might span over multiple text nodes, so a helper function is utilized. 
*/
function findMatches(nodes, lookupWord) {
	// keep matches in an array
	let matches = [];
	// iterate through the text nodes
	for (let i = 0; i < nodes.length; i++) {
		
		let nodeText = nodes[i].textContent;
		
		let startTextNodePos = i;
		let endTextNodePos = i;
		let startOffset = 0;
		let endOffset = 0;
		// the lookup text will be modiified, store it separately
		let lookupText = lookupWord;
		// search for current lookup text in current text node
		let regEx = new RegExp(lookupText, "gi");
		let lookups = nodeText.matchAll(regEx);
		// possible multiple occurrences 
		for (const match of lookups) {
			// add it as a match 
			matches.push({
				startTextNodePos: startTextNodePos, 
				endTextNodePos: endTextNodePos,
				startOffset: match.index,
				endOffset: match.index + lookupText.length,
				text: lookupWord});
		}
		// cut off part of the initial lookup string
		let lookupTextRest = "";
		// cut off letters of the lookup string and search for it at the end of the current text node.
		do {
			// slice the stings
			lookupTextRest = lookupText.slice(-1).concat(lookupTextRest);
			lookupText = lookupText.slice(0, lookupText.length-1);
			// search for the text
			regEx = new RegExp(lookupText, "gi");
			let lookupPos = nodeText.search(regEx);
			// if there's a match and it's at the text node end
			if (lookupPos > -1 && lookupPos == nodeText.length - lookupText.length) {
				// see if it continues through next nodes 
				let ends = findRestOfMatch(nodes.slice(i+1), lookupTextRest);
				// if it does
				if (ends[1] != -1) {
					// add another match 
					matches.push({
						startTextNodePos: startTextNodePos, 
						endTextNodePos: i + ends[0], 
						startOffset: lookupPos, 
						endOffset: ends[1], 
						text: lookupWord});
				}
				// jump the amount of nodes that have been checked 
				i += ends[0]; 
				break;
			}
		} while (lookupText);

	}

	return matches;
}

/*
Search for a single instance of a string. Used to check if a match spans through several nodes. Returns a two element array with the first element showing the number of nodes the match spans over and the second - the ordinal position of the end of the match within the last text node. If no match is found, the second elements is set to -1.
*/
function findRestOfMatch(nodes, lookupText) {
	// number of nodes the match spans through and its end in the last one
	let endNode = 0;
	let endOffset = -1;
	// for each node
	for (let i = 0; i < nodes.length; i++) {
		let nodeText = nodes[i].textContent;
		// check if lookupText is in the textNode or it's vice-versa
		let regEx1 = new RegExp(lookupText, "gi");
		// escape special characters if any in text node
		let regEx2 = new RegExp(nodeText.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
		let lookupPos1 = nodeText.search(regEx1);
		let lookupPos2 = lookupText.search(regEx2);
		// lookup text ends in current node
		if (lookupPos1 == 0) {
			endNode = i + 1;
			endOffset = lookupText.length;
			break;
		} // text node fits in lookup word, meaning it continues further
		else if (lookupPos2 == 0) {
			// slice it and loop to the next node
			lookupText = lookupText.slice(nodeText.length, lookupText.length);	
		}
		else { // no match found, end here
			// -1 offset means false alert
			return [i++, -1];
		}
	}

	return [endNode, endOffset];
}

/*
Insert a node after a referenceNode
*/
function insertAfter(newNode, referenceNode) {
	referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibiling);
}

/*
Create a <span> element with given text content.
*/
function createSpan(innerText) {
	let textNode = document.createTextNode(innerText);
	let spanNode = document.createElement("span");
	spanNode.classList.add(gSettings.redactClassName);
	spanNode.appendChild(textNode);
	return spanNode;
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
function redactContent(nodes, ranges, redactedWord) {

	// calculate the redaction offset - length of the redacted text
	let redactionOffset = redactedWord.length;

	// iterate backwards through the matches (itterating backwards makes it easier to refference nodes with multiple matches. Plus, it's faster ;)
	for (let i = ranges.length-1; i >= 0; i--) {

		// current match
		let range = ranges[i];
		// length of the query text (same for every range item) 
		let textLength = range.text.length;

		// match is completely in one node 
		if (range.startTextNodePos == range.endTextNodePos) {
			// simply get the node
			let node = nodes[range.startTextNodePos];
			// and split it at the redaction offset
			splitNode(node, range.startOffset, range.startOffset + redactionOffset);
		}
		// match spans over mulitple nodes
		else {
			// last node
			let lastNode = nodes[range.endTextNodePos];
			// does the redaction end in the last (or a previous) node?
			let lastNodeEnding = false;
			// the not redacted part of the matching text so far
			let notRedactedSoFar = 0;
			// if the redaction ends in last node, split it and toggle the flag
			if (lastNode.endOffset > textLength - redactionOffset) {
				splitNode(lastNode, 0, textLength - redactionOffset);
				lastNodeEnding = true;
			}
			else // count the matched text we just passed
				notRedactedSoFar += lastNode.endOffset;

			// iterate through all the middle nodes a match spans through. Do it backwards to keep consistensy.
			for (let j = range.endTextNodePos-1; j > range.startTextNodePos; j--) {
				// current node
				let middleNode = nodes[j];
				// the whole node is redacted
				if (lastNodeEnding)
					splitNode(middleNode, 0, middleNode.textContent.length);	
				// check if the redaction ends in this node, split it and mark the flag
				else if (textLength - notRedactedSoFar - middleNode.textContent.length < redactionOffset) {
					splitNode(lastNode, 0, middleNode.textContent.length - (textLength - redactionOffset - underactedSoFar));
					lastNodeEnding = true;
				}
				else // we'll get them next node
					notRedactedSoFar += middleNode.textContent.length;
			}

			// first node
			let firstNode = nodes[range.startTextNodePos];
			splitNode(firstNode, range.startOffset, firstNode.textContent.length);
		}
	}
}

/*
Removes all occurances of given phrase in the page title.
*/
function redactTitle(nWord) {
	let counter = 0;
	let regEx = new RegExp(nWord.query, "gi");
	let lookups = document.title.matchAll(regEx);
	// possible multiple occurrences 
	for (const match of lookups) {
		let newTitle = document.title.slice(0, match.index) + document.title.slice(match.index + nWord.redactedWord.length, document.title.length);
		document.title = newTitle;
		counter++;
	}
	return counter;
}

/*
Replaces the redacting style with a new class. 
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
}

function startRedacting(settings) {
	// save setting 
	gSettings = settings;
	// do nothing if addon dissabled or site whitelisted
	if (!settings.addonEnabled) {
		return;
	}
	else if (settings.whitelisted) {
		// send message to background to change browserAction icon for this tab (the icon set for specific tabs is reset on reload so it has to be set on load)
		webext.runtime.sendMessage({action: "set_icon"});
		return;
	}
	// current site matches
	let totalCount = 0;
	// for each of the hard coded NWORDS
	for (let nWord of NWORDS) {
		// find and redact matches in page title
		totalCount += redactTitle(nWord);
		// find all the matches
		let result = findMatches(getNodes(document.body), nWord.query);
		// update total count
		totalCount += result.length;
		// redact all the matches
		redactContent(getNodes(document.body), result, nWord.redactedWord);
	}
	// send new matches count to background script to be stored
	webext.runtime.sendMessage({action: "set_count", data: {count: totalCount, mutation: false}});

	return Promise.resolve();
}

// MutationObserver to watch for changes being made to the DOM, callback function starts searching and redacting on added nodes
let observer = new MutationObserver(function(mutations) {
	// do nothing if addon dissabled or site whitelisted
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
	for (let nWord of NWORDS) {
		let result = findMatches(nodes, nWord.query);
		totalCount += result.length;
		redactContent(nodes, result, nWord.redactedWord);
	}
	// send new matches count (if any) to background script to be stored
	if (totalCount) {
		webext.runtime.sendMessage({action: "set_count", data: {count: totalCount, mutation: true}});
	}
});

// get setting from background script, then do initial redacting, then watch for changes 
let gettingStorage = webext.runtime.sendMessage({action: "get_settings"});
gettingStorage
	.then(startRedacting)
	.then(() => { 
		observer.observe(document.body, {childList: true, subtree: true});
	});

// wait for a message
webext.runtime.onMessage.addListener((message) => {
	changeStyle(message.oldStyle, message.newStyle);
});
