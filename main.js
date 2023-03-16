const fs = require("fs");
const https = require("https");
const JSDOM = require("jsdom").JSDOM;

// This script scrapes address labels from etherscan, since there's no API for them.
// Large results are login + captcha gated. To get a session id:
// (1) Log in to etherscan.io
// (2) Chrome dev tools -> application -> storage -> cookies -> ASP.NET_SessionId
// (3) Copy/paste the value here
const sessionId = "";

(async function main() {

    // Reset data
    const labels = [];
    ["labels","addresses","labels.json"].forEach(d => fs.rmSync(d, {recursive:true, force:true}));
    ["labels","addresses"].forEach(d => fs.mkdirSync(d))

    // For each label
    const cloud = await retry(() => etherscan("/labelcloud"), retriableHTTP);
    for (const label of cloud.querySelectorAll(".dropdown-menu")) {
        const data = {};

        // For each of the label's links
        const selector = "a[href^='/accounts/label/'],a[href^='/tokens/label/']";
        for (const link of label.querySelectorAll(selector)) {
            data.Label ??= link.href.substring(link.href.indexOf("/label/")+7)

            // Find a human readable description of the label
            const page = await retry(() => etherscan(link.href), retriableHTTP);
            const description = page.getElementsByClassName("card mb-3")[0]?.textContent.trim();

            // For each subcategory of the label
            let subcats = page.querySelectorAll(".nav > .nav-item > a.nav-link");
            subcats = subcats.length == 0 ? [null] :
                [...subcats].map(s => ({name: s.name, val:s.getAttribute("val") }));
            for (const subcat of subcats) {

                // Find the indexes of interesting columns
                const cols = new Map([["Address", -1], ["Name Tag", -1], ["Token Name", -1]]);
                page.querySelector("tr")?.querySelectorAll("th").forEach((th,i) =>
                    cols.forEach((_,k) => th.textContent.endsWith(k) ? cols.set(k,i) : null));

                // Read the table in pages, to avoid timeouts on large results
                for (let start=0,size=10000;; start+=size) {
                    let url = `${link.href}?start=${start}&size=${size}&col=1&order=asc`;
                    if (subcat) url += `&subcatid=${subcat.val}`;
                    const table = await retry(() => etherscan(url), retriableHTTP);

                    // For each row in the table
                    const rows = table.querySelectorAll("tbody > tr");
                    for (const row of rows) {
                        const datum = {Label:data.Label};

                        // Collect data from the interesting columns
                        cols.forEach((i, col) => {
                            if (i > -1) {
                                const val = row.querySelector(`td:nth-child(${1+i})`).textContent;
                                if (val) datum[col] = val;
                            }
                        });

                        // Update the data files
                        if (description) datum.Description = description;
                        if (subcat) datum.Subcategory = subcat.name;
                        updateLabel(datum, data);
                        updateAddress(datum);
                    }

                    // If we've read all rows for the label's subcategory
                    if (rows.length < size) break;
                }
            }
        }
        if (data.Label) {
            labels.push(data.Label);
            fs.writeFileSync(`labels/${data.Label}.json`, JSON.stringify(data, null, 2));
        }
    }
    fs.writeFileSync("labels.json", JSON.stringify(labels, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });

/** Wraps an HTTP GET request in a promise. Returns the
 *  response body if successful, and {code, message} otherwise. */
function get(host, path, headers, timeout=120*1000) {
    console.debug(`GET ${host}${path}`);

    return new Promise((resolve, reject) => {
        const req = https.request({host, path, headers, timeout}, res => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => res.statusCode < 400
                ? resolve(body)
                : reject({code:res.statusCode, message:body}));
        });
        // The request must be destroyed manually on timeout.
        // https://nodejs.org/docs/latest-v18.x/api/http.html#event-timeout
        req.on("timeout", () => req.destroy()); // Emits an error event
        req.on("error", e => reject({code:e?.code == "ETIMEDOUT" ? 504 : 500, message:e}));
        req.end();
    });
}

/** Sends an authenticated HTTP GET request to etherscan and returns a DOM */
async function etherscan(path, timeout=120*1000) {
    const headers = {cookie:`ASP.NET_SessionId=${sessionId}`};
    const dom = new JSDOM(await get("etherscan.io", path, headers, timeout)).window.document;
    if (dom.querySelector("a[href='/login']")) {
        throw {code:401, message:"Not signed in to etherscan. Check the session id."};
    } else if (dom.querySelector("a[href='/busy']")) {
        throw {code:503, message:"Etherscan is busy. Try again later."};
    }
    return dom;
}

/** Retries {retriable} errors from {func} with {delay}
  * backoff increased by {mult} and optional {jitter} */
async function retry(func, retriable=(()=>true), delay=3000, mult=1.1, jitter=true) {
    try { return await func(); }
    catch (e) {
        if (!retriable(e)) throw e;
        const ms = Math.round(delay * (jitter ? 2*Math.random() : 1));
        console.warn("Retrying in %dms: %O", ms, e);
        await new Promise(r => setTimeout(r, ms));
        return retry(func, retriable, delay*mult, mult, jitter);
    }
}

/** Returns true if the error from an HTTP request is retriable */
function retriableHTTP(e) { return e?.code >= 500 }

/** Updates the label {data} with with a new {datum} */
function updateLabel(datum, data) {
    const {Label, Description, Address, ...d} = datum;
    data.Description ??= Description;
    const address = (data.Addresses ??= {})[Address] ??= {};
    Object.entries(d).forEach(([k,v]) => address[k] ??= v);
}

/** Updates the address file with a new {datum} */
function updateAddress(datum) {
    const {Address, Label, ...d} = datum;
    const file = `addresses/${Address}.json`;
    const old = !fs.existsSync(file)
        ? {Address:Address, Labels:{}}
        : JSON.parse(fs.readFileSync(file));
    const label = old.Labels[Label] ??= {};
    Object.entries(d).forEach(([k,v]) => label[k] ??= v);
    fs.writeFileSync(file, JSON.stringify(old, null, 2));
}
