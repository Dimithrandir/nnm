let settings = {};

let txtRefresh = document.getElementById("txt_refresh");
let txtEnabled = document.getElementById("txt_enabled");
let txtTotalNwords = document.getElementById("total_n_words");
let txtPageNwords = document.getElementById("page_n_words");
let chboxExtEnabled = document.getElementById("chbox_addon_enabled");
let chboxSiteEnabled = document.getElementById("chbox_site_enabled");

async function init() {
	// get current tab id
	let tabs = await browser.tabs.query({active: true, currentWindow: true});
	// send it to background and get its data from storage
	let response = await browser.runtime.sendMessage({action: "get_settings", data: {id: tabs[0].id, url: tabs[0].url}});
	settings = response;
	settings.url = tabs[0].url;
	// update html
	txtTotalNwords.innerText = response.nWordCount || 0;
	txtPageNwords.innerText = response.currentCount || 0;
	chboxExtEnabled.checked = response.addonEnabled;
	chboxSiteEnabled.checked = !response.exception;
	
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
	txtEnabled.innerText = (this.checked) ? "Enabled:" : "Disabled:";
	txtRefresh.style.display = "block";
	browser.runtime.sendMessage({action: "set_addon_enabled", data: this.checked});
};

// add/remove an exception for this site
chboxSiteEnabled.onchange = function() {
	browser.runtime.sendMessage({action: "set_site_enabled", data: {url: settings.url, toggle: this.checked}});
	txtRefresh.style.display = "block";
};

// wait for a click event 
document.addEventListener('click', (e) => {
	if (e.target.type === "radio" && settings.redactClassName != e.target.value) {
		browser.runtime.sendMessage({action: "set_style", data: e.target.value})
			.then(() => {settings.redactClassName = e.target.value;});
	}
});
