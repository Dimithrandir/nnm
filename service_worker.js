// default storage
const defaultStorage = {
	addonEnabled: true,
	nWordCount: 0,
	redactClassName: "redacted-word-black",
	whitelist: []
};

// make API browser agnostic
const [webext, manV3] = (typeof browser === "object") ? [browser, false] : [chrome, true];
const webextAction = webext.browserAction || webext.action;

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
Set the action icon. Toggles between ON and OFF icons. If tabId is null, it affects all tabs.
*/
function setActionIcon(toggle, tabId) {
	webextAction.setIcon({
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
		webext.storage.local.set(defaultStorage);
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
				// TODO read from storage.local before sending response because it might happend that a message is recieved before reading storage on load
				if (manV3) {
					webext.storage.local.get().then((storage) => {
						getStorage(storage);
						sendResponse({
							addonEnabled: addonEnabled,
							whitelisted: whitelist.includes(getSiteName(sender.tab.url)),
							redactClassName: redactClassName
						});
					});
				}
				else {
					sendResponse({
						addonEnabled: addonEnabled,
						whitelisted: whitelist.includes(getSiteName(sender.tab.url)),
						redactClassName: redactClassName
					});
				}
			}
			// message was sent from a popup
			else {
				if (manV3) {
					key = message.data.id.toString();
					webext.storage.session.get(key, (count) => {
						sendResponse({
							addonEnabled: addonEnabled,
							nWordCount: nWordCount,
							currentCount: {count: count[key] || 0},
							whitelisted: whitelist.includes(getSiteName(message.data.url)),
							redactClassName: redactClassName
						});
					});
				}
				else {
					sendResponse({
						addonEnabled: addonEnabled,
						nWordCount: nWordCount,
						currentCount: currentCount[message.data.id],
						whitelisted: whitelist.includes(getSiteName(message.data.url)),
						redactClassName: redactClassName
					});
				}
			}
			return true;
			break;
		case "set_addon_enabled":
			addonEnabled = message.data.toggle;
			webext.storage.local.set({addonEnabled: addonEnabled});
			// set action icon on or off (for all tabs)
			setActionIcon(addonEnabled, null);
			// if site is whitelisted, don't change back to ON for this tab
			if (addonEnabled && message.data.whitelisted)
				setActionIcon(false, message.data.tabId);
			// delete current counters for all tabs when disabled
			if (!addonEnabled) {
				if (manV3)
					webext.storage.session.clear();
				else
					currentCount = [];
			}
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
			// set action icon on or off (for current tab only, before it reloads)
			if (addonEnabled)
				setActionIcon(message.data.toggle, message.data.tabId);
			// store the whitelist
			webext.storage.local.set({whitelist: whitelist});
			break;
		case "set_icon":
			// set icon to OFF on content script load for whitelisted sites
			setActionIcon(false, sender.tab.id);
			// delete current counter for this tab
			if (manV3)
				webext.storage.session.remove(sender.tab.id.toString())
			else
				currentCount[sender.tab.id] = null;
			break;
		case "set_count":
			if (manV3) {
				webext.storage.session.get(sender.tab.id.toString()).then((count) => {
					// define counter for new tabs
					if (!count) {
						count = 0;
					}
					// update count from observed page change
					if (message.data.mutation) {
						count += message.data.count;
					}
					// new url opened
					else {
						count = message.data.count;
					}
					// set badge color
					webextAction.setBadgeBackgroundColor({color: "#666666"});
					// update badge
					webextAction.setBadgeText({
						text: (count > 0) ? count.toString() : "",
						tabId: sender.tab.id
					});
					// update and store total count
					nWordCount += message.data.count;
					webext.storage.local.set({nWordCount: nWordCount});
					webext.storage.session.set({[sender.tab.id]: count});
					return true;
				});
			}
			else {
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
				// set badge color
				webextAction.setBadgeBackgroundColor({color: "#666666"});
				// update badge
				webextAction.setBadgeText({
					text: (currentCount[sender.tab.id].count > 0) ? (currentCount[sender.tab.id].count).toString() : "",
					tabId: sender.tab.id
				});
				// update and store total count
				nWordCount += message.data.count;
				webext.storage.local.set({nWordCount: nWordCount});
			}
			break;
		case "set_style":
			// current class name 
			let oldStyle = redactClassName;
			// new class name selected in the popup
			let newStyle = message.data;
			redactClassName = newStyle;
			webext.storage.local.set({redactClassName: newStyle})
				// get all tabs
				.then(() => {
					return webext.tabs.query({});
				})
				// send a message with old and new class names to each one
				.then(tabs => {
					for (let tab of tabs) {
						webext.tabs.sendMessage(tab.id, {oldStyle: oldStyle, newStyle: newStyle});
					}
				})
				.catch(onError);
			break;
		default:
			return;
	}
}

function listenForMessages1(message, sender, sendResponse) {

	switch(message.action) {
		case "get_settings":
			// if message was sent from a content script
			if (message.data == null) {
				// TODO read from storage.local before sending response because it might happend that a message is recieved before reading storage on load
				if (manV3) {
					webext.storage.local.get().then((storage) => {
						getStorage(storage);
						sendResponse({
							addonEnabled: addonEnabled,
							whitelisted: whitelist.includes(getSiteName(sender.tab.url)),
							redactClassName: redactClassName
						});
					});
				}
				else {
					sendResponse({
						addonEnabled: addonEnabled,
						whitelisted: whitelist.includes(getSiteName(sender.tab.url)),
						redactClassName: redactClassName
					});
				}
			}
			// message was sent from a popup
			else {
				if (manV3) {
					key = message.data.id.toString();
					webext.storage.session.get(key, (count) => {
						sendResponse({
							addonEnabled: addonEnabled,
							nWordCount: nWordCount,
							currentCount: {count: count[key] || 0},
							whitelisted: whitelist.includes(getSiteName(message.data.url)),
							redactClassName: redactClassName
						});
					});
				}
				else {
					sendResponse({
						addonEnabled: addonEnabled,
						nWordCount: nWordCount,
						currentCount: currentCount[message.data.id],
						whitelisted: whitelist.includes(getSiteName(message.data.url)),
						redactClassName: redactClassName
					});
				}
			}
			return true;
			break;
		case "set_addon_enabled":
			addonEnabled = message.data.toggle;
			webext.storage.local.set({addonEnabled: addonEnabled});
			// set action icon on or off (for all tabs)
			setActionIcon(addonEnabled, null);
			// if site is whitelisted, don't change back to ON for this tab
			if (addonEnabled && message.data.whitelisted)
				setActionIcon(false, message.data.tabId);
			// delete current counters for all tabs when disabled
			if (!addonEnabled) {
				if (manV3)
					webext.storage.session.clear();
				else
					currentCount = [];
			}
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
			// set action icon on or off (for current tab only, before it reloads)
			if (addonEnabled)
				setActionIcon(message.data.toggle, message.data.tabId);
			// store the whitelist
			webext.storage.local.set({whitelist: whitelist});
			break;
		case "set_icon":
			// set icon to OFF on content script load for whitelisted sites
			setActionIcon(false, sender.tab.id);
			// delete current counter for this tab
			if (manV3)
				webext.storage.session.remove(sender.tab.id.toString())
			else
				currentCount[sender.tab.id] = null;
			break;
		case "set_count":
			if (manV3) {
				webext.storage.session.get(sender.tab.id.toString()).then((count) => {
					// define counter for new tabs
					if (!count) {
						count = 0;
					}
					// update count from observed page change
					if (message.data.mutation) {
						count += message.data.count;
					}
					// new url opened
					else {
						count = message.data.count;
					}
					// set badge color
					webextAction.setBadgeBackgroundColor({color: "#666666"});
					// update badge
					webextAction.setBadgeText({
						text: (count > 0) ? count.toString() : "",
						tabId: sender.tab.id
					});
					// update and store total count
					nWordCount += message.data.count;
					webext.storage.local.set({nWordCount: nWordCount});
					webext.storage.session.set({[sender.tab.id]: count});
					return true;
				});
			}
			else {
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
				// set badge color
				webextAction.setBadgeBackgroundColor({color: "#666666"});
				// update badge
				webextAction.setBadgeText({
					text: (currentCount[sender.tab.id].count > 0) ? (currentCount[sender.tab.id].count).toString() : "",
					tabId: sender.tab.id
				});
				// update and store total count
				nWordCount += message.data.count;
				webext.storage.local.set({nWordCount: nWordCount});
			}
			break;
		case "set_style":
			// current class name 
			let oldStyle = redactClassName;
			// new class name selected in the popup
			let newStyle = message.data;
			redactClassName = newStyle;
			webext.storage.local.set({redactClassName: newStyle})
				// get all tabs
				.then(() => {
					return webext.tabs.query({});
				})
				// send a message with old and new class names to each one
				.then(tabs => {
					for (let tab of tabs) {
						webext.tabs.sendMessage(tab.id, {oldStyle: oldStyle, newStyle: newStyle});
					}
				})
				.catch(onError);
			break;
		default:
			return;
	}
}

// check the storage and set icon on browser startup
webext.runtime.onStartup.addListener(() => {
	let gettingStoredValues = webext.storage.local.get();
	gettingStoredValues.then(getStorage, onError).then(() => {
		setActionIcon(addonEnabled, null);
	});
})

// check the storage on load
let gettingStoredValues = webext.storage.local.get();
gettingStoredValues.then(getStorage, onError);

// wait for a message from content script or addon popup
webext.runtime.onMessage.addListener(listenForMessages);
