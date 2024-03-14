// default storage
const defaultStorage = {
	addonEnabled: true,
	nWordCount: 0,
	redactClassName: "redacted-word-black",
	whitelist: []
};

/*
Generic error logger.
*/
function onError(e) {
	console.error(e);
}

/*
Check if object is empty
*/
function isEmpty(object) {
	return Object.keys(object).length === 0;
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
	chrome.action.setIcon({
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
Handle received messages.
*/
function listenForMessages(message, sender, sendResponse) {
	switch(message.action) {
		case "get_settings":	
			chrome.storage.local.get().then((storedValues) => {
				let values = isEmpty(storedValues) ? defaultStorage : storedValues;
				// if message was sent from a content script
				if (message.data == null) {
					sendResponse({
						addonEnabled: values.addonEnabled,
						whitelisted: values.whitelist.includes(getSiteName(sender.tab.url)),
						redactClassName: values.redactClassName
					});
				}
				// message was sent from a popup
				else {
					let key = message.data.id.toString();
					chrome.storage.session.get(key).then((count) => {
						sendResponse({
							addonEnabled: values.addonEnabled,
							nWordCount: values.nWordCount,
							currentCount: {count: count[key] || 0},
							whitelisted: values.whitelist.includes(getSiteName(message.data.url)),
							redactClassName: values.redactClassName
						});
					});
				}
			});
			return true;
		case "set_addon_enabled":
			let addonEnabled = message.data.toggle;
			chrome.storage.local.set({addonEnabled: addonEnabled});
			// set action icon on or off (for all tabs)
			setActionIcon(addonEnabled, null);
			// if site is whitelisted, don't change back to ON for this tab
			if (addonEnabled && message.data.whitelisted)
				setActionIcon(false, message.data.tabId);
			// delete current counters for all tabs when disabled
			if (!addonEnabled) {
				chrome.storage.session.clear();
			}
			break;
		case "set_site_enabled":
			chrome.storage.local.get().then((storedValues) => {
				let values = isEmpty(storedValues) ? defaultStorage : storedValues;
				// get site domain name
				let siteName = getSiteName(message.data.url);
				// enable site => remove from whitelist
				if (message.data.toggle) {
					if (values.whitelist.includes(siteName)) {
						values.whitelist.splice(values.whitelist.indexOf(siteName), 1);
					}
				}
				// disable site => add to whitelist
				else {
					values.whitelist.push(siteName);
				}
				// set action icon on or off (for current tab only, before it reloads)
				if (values.addonEnabled)
					setActionIcon(message.data.toggle, message.data.tabId);
				// store the whitelist
				chrome.storage.local.set({whitelist: values.whitelist});
			});
			break;
		case "set_icon":
			// set icon to OFF on content script load for whitelisted sites
			setActionIcon(false, sender.tab.id);
			// delete current counter for this tab
			chrome.storage.session.remove(sender.tab.id.toString());
			break;
		case "set_count":
			// get nWord count for current tab from session storage, if such entry exists
			chrome.storage.session.get(sender.tab.id.toString()).then((result) => {
				let count = result[sender.tab.id.toString()] || 0;
				// update count from observed page change
				if (message.data.mutation) {
					count += message.data.count;
				}
				// new url opened
				else {
					count = message.data.count;
				}
				// set badge color
				chrome.action.setBadgeBackgroundColor({color: "#666666"});
				// update badge
				chrome.action.setBadgeText({
					text: (count > 0) ? count.toString() : "",
					tabId: sender.tab.id
				});
				// update and store total count to local and tab count to session storage
				chrome.storage.local.get("nWordCount").then((result) => {
					chrome.storage.local.set({nWordCount: result.nWordCount + message.data.count});
					chrome.storage.session.set({[sender.tab.id]: count});
				});
			});
			break;
		case "set_style":
			chrome.storage.local.get("redactClassName").then((result) => {
				// current class name 
				let oldStyle = result.redactClassName || defaultStorage.redactClassName;
				// new class name selected in the popup
				let newStyle = message.data;
				chrome.storage.local.set({redactClassName: newStyle})
					// get all tabs
					.then(() => {
						return chrome.tabs.query({});
					})
					// send a message with old and new class names to each one
					.then(tabs => {
						for (let tab of tabs) {
							chrome.tabs.sendMessage(tab.id, {oldStyle: oldStyle, newStyle: newStyle});
						}
					})
					.catch(onError);
				});
			break;
		default:
			return;
	}
}

// store default values on install
chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason === "install") {
		chrome.storage.local.set(defaultStorage);
	}
});

// check status on browser startup
chrome.runtime.onStartup.addListener(() => {
	chrome.storage.local.get("addonEnabled").then((result) => {
		setActionIcon(result.addonEnabled, null);
		chrome.action.setBadgeBackgroundColor({color: "#666666"});
	});
});

// wait for a message from content script or addon popup
chrome.runtime.onMessage.addListener(listenForMessages);
