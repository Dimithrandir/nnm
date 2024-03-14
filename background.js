// default storage
const defaultStorage = {
	addonEnabled: true,
	nWordCount: 0,
	redactClassName: "redacted-word-black",
	whitelist: []
};

// current settings
let addonEnabled = false;
let nWordCount = 0;
let currentCount = [];
let redactClassName = "";
let whitelist = [];

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
Set the browserAction icon. Toggles between ON and OFF icons. If tabId is null, it affects all tabs.
*/
function setBrowserActionIcon(toggle, tabId) {
	browser.browserAction.setIcon({
		path: toggle ? {
			16: "img/nnm-16.png",
			32: "img/nnm-32.png" 
		} : {
			16: "img/nnm-16-off.png",
			32: "img/nnm-32-off.png" 
		},
		tabId: tabId
	});
}

/*
Check if anything is stored on startup, insert default values if not.
*/
function getStorage(storedValues) {
	// check if storage is undefined
	if (!storedValues.nWordCount || !storedValues.redactClassName || !storedValues.redactClassName || !storedValues.whitelist) {
		// insert default values 
		browser.storage.local.set(defaultStorage);
		addonEnabled = defaultStorage.addonEnabled;
		redactClassName = defaultStorage.redactClassName;
		whitelist = defaultStorage.whitelist;
	}
	else {
		addonEnabled = storedValues.addonEnabled;
		nWordCount = storedValues.nWordCount; 
		redactClassName = storedValues.redactClassName;
		whitelist = storedValues.whitelist; 
	}
}

/*
Handle received messages.
*/
function listenForMessages(message, sender, sendResponse) {
	switch(message.action) {
		case "get_settings":
			// if message was sent from a content script
			if (message.data == null) {
				sendResponse({addonEnabled: addonEnabled, whitelisted: whitelist.includes(getSiteName(sender.tab.url)), redactClassName: redactClassName});
			}
			// message was sent from a popup
			else {
				sendResponse({addonEnabled: addonEnabled, nWordCount: nWordCount, currentCount: currentCount[message.data.id], whitelisted: whitelist.includes(getSiteName(message.data.url)), redactClassName: redactClassName});
			}
			break;
		case "set_addon_enabled":
			addonEnabled = message.data.toggle;
			browser.storage.local.set({addonEnabled: addonEnabled});
			// set action icon on or off (for all tabs)
			setBrowserActionIcon(addonEnabled, null);
			// if site is whitelisted, don't change back to ON for this tab
			if (addonEnabled && message.data.whitelisted)
				setBrowserActionIcon(false, message.data.tabId);
			// delete current counters for all tabs when disabled
			if (!addonEnabled)
				currentCount = [];
			break;
		case "set_site_enabled":
			// get site domain name
			let siteName = getSiteName(message.data.url);
			// enable site => remove from whitelist
			if (message.data.toggle) {
				if (whitelist.includes(siteName)) {
					whitelist.splice(whitelist.indexOf(siteName), 1);
				}
			}
			// disable site => add to whitelist
			else {
				whitelist.push(siteName);
			}
			// set browserAction icon on or off (for current tab only, before it reloads)
			if (addonEnabled)
				setBrowserActionIcon(message.data.toggle, message.data.tabId);
			// store the whitelist
			browser.storage.local.set({whitelist: whitelist});
			break;
		case "set_icon":
			// set icon to OFF on content script load for whitelisted sites
			setBrowserActionIcon(false, sender.tab.id);
			// delete current counter for this tab
			currentCount[sender.tab.id] = null;
			break;
		case "set_count":
			// define counter for new tabs
			if (!currentCount[sender.tab.id]) {
				currentCount[sender.tab.id] = {url: sender.tab.url, count: 0};
			}
			// update count from observed page change
			if (message.data.mutation) {
				currentCount[sender.tab.id].count += message.data.count;
			}
			// new url opened
			else {
				currentCount[sender.tab.id] = {url: sender.tab.url, count: message.data.count};
			}
			// update badge
			browser.browserAction.setBadgeText({
				text: (currentCount[sender.tab.id].count > 0) ? (currentCount[sender.tab.id].count).toString() : "",
				tabId: sender.tab.id
			});
			// update and store total count
			nWordCount += message.data.count;
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
						browser.tabs.sendMessage(tab.id, {oldStyle: oldStyle, newStyle: newStyle}).catch(onError);
					}
				})
				.catch(onError);
			break;
		default:
			return;
	}
}

// check the storage on loading
// run on top level since runtime.onStartup doesn't fire in private/incognito mode as per docs
let gettingStoredValues = browser.storage.local.get();
gettingStoredValues.then(getStorage, onError).then(() => {
	setBrowserActionIcon(addonEnabled, null);
	browser.browserAction.setBadgeBackgroundColor({color: "#666666"});
});

// wait for a message from content script or addon popup
browser.runtime.onMessage.addListener(listenForMessages);
