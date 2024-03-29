// make API browser agnostic
const webext = ( typeof browser === "object" ) ? browser : chrome;

let settings = {};

let txtRefresh = document.getElementById("txt_refresh");
let txtEnabled = document.getElementById("txt_enabled");
let txtTotalNwords = document.getElementById("total_n_words");
let txtPageNwords = document.getElementById("page_n_words");
let chboxExtEnabled = document.getElementById("chbox_addon_enabled");
let chboxSiteEnabled = document.getElementById("chbox_site_enabled");

async function init() {
	// localize labels
	document.querySelectorAll('[data-locale]').forEach((span) => {
		span.innerText = webext.i18n.getMessage(span.dataset.locale);
	});
	// get current tab id
	let tabs = await webext.tabs.query({active: true, currentWindow: true});
	// send it to background and get its data from storage
	let response = await webext.runtime.sendMessage({action: "get_settings", data: {id: tabs[0].id, url: tabs[0].url}});
	settings = response;
	settings.url = tabs[0].url;
	settings.tabId = tabs[0].id;
	// update html
	txtTotalNwords.innerText = response.nWordCount || 0;
	txtPageNwords.innerText = (response.currentCount && !response.whitelisted) ? response.currentCount.count : 0;
	txtEnabled.innerText = (response.addonEnabled) ? webext.i18n.getMessage("enabled") : webext.i18n.getMessage("disabled");
	chboxExtEnabled.checked = response.addonEnabled;
	chboxSiteEnabled.checked = !response.whitelisted;
	
	let inputs = document.getElementsByTagName("input");
	for (let element of inputs) {
		if (element.type === "radio" && element.value === response.redactClassName) {
			element.checked = true;
		}
	}
}

init();

// enable/disable toggle checkbox
chboxExtEnabled.onchange = function() {
	txtEnabled.innerText = (this.checked) ? webext.i18n.getMessage("enabled") : webext.i18n.getMessage("disabled");
	txtRefresh.style.display = "block";
	webext.runtime.sendMessage({action: "set_addon_enabled", data: {toggle: this.checked, whitelisted: !chboxSiteEnabled.checked, tabId: settings.tabId}});
};

// add/remove this site to/from whitelist
chboxSiteEnabled.onchange = function() {
	webext.runtime.sendMessage({action: "set_site_enabled", data: {toggle: this.checked, url: settings.url, tabId: settings.tabId}});
	txtRefresh.style.display = "block";
};

// wait for a click event 
document.addEventListener('click', (e) => {
	if (e.target.type === "radio" && settings.redactClassName != e.target.value) {
		webext.runtime.sendMessage({action: "set_style", data: e.target.value})
			.then(() => {settings.redactClassName = e.target.value;});
	}
});
