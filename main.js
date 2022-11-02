
const https = require("https");
const JSDOM = require("jsdom").JSDOM;

// This script scrapes address labels from etherscan, since there's no API for them.
// Large results are login + captcha gated. To get a session id:
// (1) Log in to etherscan.io
// (2) Chrome dev tools -> application -> storage -> cookies -> ASP.NET_SessionId
// (3) Copy/paste the value here
const sessionId = "";

(async function main() {

    // For each label
    const labels = await retry(() => etherscan("/labelcloud"), retriableHTTP);
    for (let label of labels.window.document.querySelectorAll('a[href*="/label/"]')) {

        // Find a human readable description of the label
        const page = await retry(() => etherscan(label.href), retriableHTTP);
        let description = page.window.document.getElementsByClassName("card mb-3")[0]?.textContent.trim();

        // For each subcategory of the label
        let subcats = page.window.document.querySelectorAll(".nav > .nav-item > a.nav-link");
        subcats = subcats.length == 0 ? [null] : [...subcats].map(s => s.getAttribute("val"));
        for (let subcat of subcats) {

            // Read the addresses in pages, to avoid timeouts on large results
            for (let start=0,size=10000;; start+=size) {
                let url = `${label.href}?start=${start}&size=${size}&col=1&order=asc`;
                if (subcat != null) url += `&subcatid=${subcat}`;
                const addresses = await retry(() => etherscan(url), retriableHTTP);

                // TODO: Why can't JSDOM find them with 'tr[role="row"] > td:first-child'?
                const iter = addresses.window.document.documentElement.outerHTML.matchAll(/['"]\/address\/(0x[0-9a-f]{40})['"]>0x/g);
                let {value,done} = iter.next();
                if (done) break; // If we've read all addresses for the label's subcategory
                do {
                    console.log(value[1]);
                } while (!({value,done} = iter.next()).done);
            }
        }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });

/** Wraps an HTTP GET request in a promise */
function get(host, path, headers, timeout=120*1000) {
    console.debug(`GET ${host}${path} ${JSON.stringify(headers) ?? ''}`);

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
    var dom = new JSDOM(await get('etherscan.io', path, {cookie:`ASP.NET_SessionId=${sessionId}`}, timeout));
    if (dom.window.document.querySelector("a[href='/login']")) {
        throw {code:401, message:"Not signed in to etherscan. Check the session id."};
    } else if (dom.window.document.querySelector("a[href='/busy']")) {
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
