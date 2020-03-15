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

let settings = {};
let redactClassName = "";

/*
Get all the text nodes into a single array
*/
function getNodes() {
	let walker = document.createTreeWalker(document.body, window.NodeFilter.SHOW_TEXT, null, false);
	let nodes = [];
	while (node = walker.nextNode()) {
		if (node.parentNode.tagName.toLowerCase() !== "script") {
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
	let endOffset = 0;
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
	spanNode.classList.add(redactClassName);
	spanNode.appendChild(textNode);
	return spanNode;
}

/*
Takes a text node and splits its content into three parts, the middle of them containing the redacted word of the matching text and having custom style applied.
*/
function splitNode(node, startOffset, endOffset) {

	// no need of splitting for element nodes, just insert custom style and return
	if (node.nodeType == Node.ELEMENT_NODE) {
		node.classList.add(redactClassName);
		//node.classList.add("redacted-word-border");
		return;
	}

	// break off a text node that begins at the match end (that will contain everything after the match)
	let postNode = node.splitText(endOffset);
	// break off a text node that begins at the match start (that will contain THE match)
	let midNode = node.splitText(startOffset);

	// create a new span node with the snapped node text content (the match)
	let newMidTextNode = document.createTextNode(midNode.textContent);
	let newMidSpanNode = document.createElement("span");
	newMidSpanNode.classList.add(redactClassName);
	//newMidSpanNode.classList.add("redacted-word-border");
	newMidSpanNode.appendChild(newMidTextNode);

	// insert it after the match text node
	node.parentNode.insertBefore(newMidSpanNode, postNode);

	// remove the original match text node
	node.parentNode.removeChild(midNode);
}

/*
Get all the text nodes in the document, then for each match, apply custom style to the redacted word in the matching text node. If the matching node is just a text node, splits out the matching text in a <span> element. Goes through multiple nodes if the match spans through them. 
*/
function redact(ranges, redactedWord) {

	// get all nodes in document 
	let nodes = getNodes();

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
Replaces the redacting style with a new class. 
*/
function changeStyle(oldStyle, newStyle) {
	// get all redacted nodes
	let redactedNodes = document.getElementsByClassName(oldStyle);
	if(redactedNodes.length > 0) {
		// this is a live node list, it changes as the DOM changes, so it's best to change the first element while the list is not empty 
		while (redactedNodes.length) {
			redactedNodes[0].classList.replace(oldStyle, newStyle);
		}
	}
}

function startRedacting(settings) {
	// do nothing if addon dissabled or exception for site added
	if(!settings.addonEnabled || settings.exception) {
		return;
	}
	redactClassName = settings.redactClassName;
	// current site matches
	let totalCount = 0;
	// for each of the hard coded NWORDS
	for (let nWord of NWORDS) {
		// find all the matches
		let result = findMatches(getNodes(), nWord.query);
		// update total count
		totalCount += result.length;
		// redact all the matches
		redact(result, nWord.redactedWord);
	}
	// send new matches count to background script to be stored
	browser.runtime.sendMessage({action: "set_count", data: totalCount});
}

// get setting from background script
let gettingStorage = browser.runtime.sendMessage({action: "get_settings"}); // .storage.local.get(["addonEnabled", "exceptions"]);
gettingStorage.then(startRedacting);

// wait for a message
browser.runtime.onMessage.addListener((message) => {
	changeStyle(message.oldStyle, message.newStyle);
});

/*
const callback = function(mutationsList, observer) {
	for (let mutation of mutationsList) {
		if (mutation.type === 'childList') {
			console.log(mutation);
		}
	}
};

const observer = new MutationObserver(callback);

// observer.observe(document.body, {childList: true, subtree: true});
*/
