const fs = require("fs");
const https = require("https");
const JSDOM = require("jsdom").JSDOM;

// This script scrapes labels from etherscan, since there's no API for them.
// Large results are login + captcha gated. To get a session id:
// (1) Log in to etherscan.io
// (2) Chrome dev tools -> application -> storage -> cookies -> ASP.NET_SessionId
// (3) Copy/paste the value here
const sessionId = "";

(async function main() {

    // Reset data directories
    for (const dir of ["labels", "addresses"]) {
        fs.rmSync(dir, {recursive:true, force:true});
        fs.mkdirSync(dir);
    }

    // For each label
    const labels = await retry(() => etherscan("/labelcloud"), retriableHTTP);
    for (const label of labels.querySelectorAll('a[href*="/label/"]')) {
        const name = label.href.substring(label.href.indexOf("/label/")+7);

        // Find a human readable description of the label
        const page = await retry(() => etherscan(label.href), retriableHTTP);
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
                let url = `${label.href}?start=${start}&size=${size}&col=1&order=asc`;
                if (subcat) url += `&subcatid=${subcat.val}`;
                const table = await retry(() => etherscan(url), retriableHTTP);
                const rows = table.querySelectorAll("tr[class='even'],tr[class='odd']");

                // For each row in the table
                for (const row of rows) {
                    const data = {Label:name};

                    // Collect data from the interesting columns
                    cols.forEach((i, col) => {
                        if (i > -1) {
                            const value = row.querySelector(`td:nth-child(${1+i})`).textContent;
                            if (value) data[col] = value;
                        }
                    });

                    // Write the data to files
                    if (description) data.Description = description;
                    if (subcat) data.Subcategory = subcat.name;
                    updateLabel(data);
                    updateAddress(data);
                }

                // If we've read all rows for the label's subcategory
                if (rows.length < size) break;
            }
        }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });

/** Wraps an HTTP GET request in a promise */
function get(host, path, headers, timeout=120*1000) {
    console.debug(`GET ${host}${path}`);

    return new Promise((resolve, reject) => {
        const req = https.request({host, path, headers, timeout}, res => {
            let body = "";
            res.on('data', chunk => body += chunk);
            res.on('end', () => res.statusCode < 400
                ? resolve(body)
                : reject({code:res.statusCode, message:body}));
        });
        // The request must be destroyed manually on timeout.
        // https://nodejs.org/docs/latest-v18.x/api/http.html#event-timeout
        req.on('timeout', () => req.destroy()); // Emits an error event
        req.on('error', err => reject(err));
        req.end();
    });
}

/** Sends an authenticated HTTP GET request to etherscan and returns a DOM */
async function etherscan(path, timeout=120*1000) {
    const headers = {cookie:`ASP.NET_SessionId=${sessionId}`};
    const dom = new JSDOM(await get('etherscan.io', path, headers, timeout)).window.document;
    if (dom.querySelector("a[href='/login']")) {
        throw {code:401, message:"Not signed in to etherscan. Check the session id."};
    } else if (dom.querySelector("a[href='/busy']")) {
        throw {code:503, message:"Etherscan is busy. Try again later."};
    }
    return dom;
}

/** Retries {retriable} errors from {func} with {delay}
  * backoff increased by {mult} and optional {jitter} */
async function retry(func, retriable=(()=>true), delay=500, mult=1.2, jitter=true) {
    try { return await func(); }
    catch (e) {
        if (!retriable(e)) throw e;
        const ms = Math.round(delay * (jitter ? 2*Math.random() : 1));
        console.warn("Retrying in %dms: %s", ms, e);
        await new Promise(r => setTimeout(r, ms));
        return retry(func, retriable, delay*mult, mult);
    }
}

/** Returns true if the error from an HTTP request is retriable */
function retriableHTTP(e) { return e?.code >= 500 }

/** Updates a label file with new {data} */
function updateLabel(data) {
    const {Label, Description, ...d} = data;
    const file = `labels/${Label}.json`;
    const old = !fs.existsSync(file)
        ? { Label:Label, Description:Description, Addresses:[] }
        : JSON.parse(fs.readFileSync(file));
    old.Addresses.push(d);
    fs.writeFileSync(file, JSON.stringify(old, null, 2));
}

/** Updates an address file with new {data} */
function updateAddress(data) {
    const {Address, ...d} = data;
    const file = `addresses/${Address}.json`;
    const old = !fs.existsSync(file)
        ? {Address:Address, Labels:[]}
        : JSON.parse(fs.readFileSync(file));
    old.Labels.push(d)
    fs.writeFileSync(file, JSON.stringify(old, null, 2));
}
