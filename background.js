// default storage
const defaultStorage = {
	addonEnabled: true,
	nWordCount: 0,
	redactClassName: "redacted-word-black",
	exceptions: []
};

// current settings
let addonEnabled = false;
let nWordCount = 0;
let currentCount = [];
let redactClassName = "";
let exceptions = [];

/*
Generic error logger.
*/
function onError(e) {
	console.error(e);
}

/*
Extract site name from given url
*/
function getSiteName(url) {
	let regEx = new RegExp("[a-z]+:\/\/[a-z0-9\.]+\/", "gi");
	let matches = [...url.matchAll(regEx)];
	let siteName = (matches.length) ? matches[0][0] : url;
	return siteName;
}

/*
Check if anything is stored on startup, insert default values if not.
*/
function getStorage(storedValues) {
	// check if storage is undefined
	if (!storedValues.addonEnabled || !storedValues.nWordCount || !storedValues.redactClassName || !storedValues.redactClassName) {
		// insert default values 
		browser.storage.local.set(defaultStorage);
		addonEnabled = defaultStorage.addonEnabled;
		exceptions = defaultStorage.exceptions;
		redactClassName = defaultStorage.redactClassName;
	}
	else {
		addonEnabled = storedValues.addonEnabled;
		nWordCount = storedValues.nWordCount; 
		exceptions = storedValues.exceptions;
		redactClassName = storedValues.redactClassName;
	}
}

/*
Handle received messages.
*/
function listenForMessages(message, sender, sendResponse) {
	switch(message.action) {
		case "get_settings":
			// if message was sent from a content script
			if (sender.envType === "content_child") {
				sendResponse({addonEnabled: addonEnabled, exception: exceptions.includes(getSiteName(sender.tab.url)), redactClassName: redactClassName});
			}
			// message was sent from a popup
			else {
				sendResponse({addonEnabled: addonEnabled, nWordCount: nWordCount, currentCount: currentCount[message.data.id], exception: exceptions.includes(getSiteName(message.data.url)), redactClassName: redactClassName});
			}
			break;
		case "set_addon_enabled":
			addonEnabled = message.data;
			browser.storage.local.set({addonEnabled: addonEnabled});
			break;
		case "set_site_enabled":
			// get site domain name
			let siteName = getSiteName(message.data.url);
			// enable site => remove an exception 
			if (message.data.toggle) {
				if (exceptions.includes(siteName)) {
					exceptions.splice(exceptions.indexOf(siteName), 1);
				}
			}
			// dissable site => add an exception for it
			else {
				exceptions.push(siteName);
			}
			browser.storage.local.set({exceptions: exceptions});
			break;
		case "set_count":
			// define counter for new tabs
			if (!currentCount[sender.tab.id]) {
				currentCount[sender.tab.id] = {url: sender.tab.url, count: 0};
			}
			// update count from observed page change
			if (currentCount[sender.tab.id].url == sender.tab.url) {
				currentCount[sender.tab.id].count += message.data;
			}
			// new url opened in old tab
			else {
				currentCount[sender.tab.id] = {url: sender.tab.url, count: message.data};
			}
			nWordCount += message.data;	
			browser.storage.local.set({nWordCount: nWordCount});
			break;
		case "set_style":
			// current class name 
			let oldStyle = redactClassName;
			// new class name selected in the popup
			let newStyle = message.data;
			redactClassName = newStyle;
			browser.storage.local.set({redactClassName: newStyle})
				// get all tabs
				.then(() => {
					return browser.tabs.query({});
				})
				// send a message with old and new class names to each one
				.then(tabs => {
					for (let tab of tabs) {
						browser.tabs.sendMessage(tab.id, {oldStyle: oldStyle, newStyle: newStyle});
					}
				})
				.catch(onError);
			break;
		default:
			return;
	}
}

// check the storage on startup
let gettingStoredValues = browser.storage.local.get();
gettingStoredValues.then(getStorage, onError);

// wait for a message from content script or addon popup
browser.runtime.onMessage.addListener(listenForMessages);
