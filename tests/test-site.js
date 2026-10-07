"use strict";
/* Ergo Astronaut site tests — run: node tests/test-site.js */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const guide = fs.readFileSync(path.join(root, "guides", "getting-started-ergo.md"), "utf8");
const app = require(path.join(root, "app.js"));

const ERG = "9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy";
let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + " " + name);
  if (!cond) failures++;
}

/* attribution on every user-facing surface */
for (const [label, doc] of [["index.html", html], ["README", readme], ["guide", guide]]) {
  check("ERG donation address in " + label, doc.includes(ERG));
  check("@kshot9000 in " + label, doc.includes("@kshot9000"));
  check("Ergo team GitHub tag in " + label, doc.includes("@ergoplatform"));
}
check("Ergo team X tag in index.html", html.includes("@ergo_platform"));
check("Ergo team X tag in README", readme.includes("@ergo_platform"));
check("honesty line in index.html", html.includes("Not affiliated with the Ergo Foundation"));
check("honesty line in README", readme.includes("not affiliated with the Ergo Foundation"));
check("cross-chain section on hub", html.includes('id="crosschain"') && html.includes("Rosen Bridge") && html.includes("app.rosen.tech"));
check("integration lab labelled planned", html.includes("planned lab work") || html.includes("Planned lab work"));
check("cross-chain in README", readme.includes("Rosen Bridge") && readme.includes("app.rosen.tech"));

/* document structure */
check("exactly one <h1>", (html.match(/<h1[ >]/g) || []).length === 1);
check("has <main> landmark", /<main[\s>]/.test(html));
check("all main form controls labelled", ["q", "erg", "nanoerg", "addr-in"].every(id => html.includes(`for="${id}"`)));
check("cache keys present", html.includes("styles.css?v=1") && html.includes("app.js?v=1"));
check("catalogue has 14 cards", (html.match(/class="card"/g) || []).length === 14);

/* catalogue links — all verified HTTP 200 at launch */
const LINKS = [
  "https://kshot3000.github.io/MY-ERGO-DEX/", "https://github.com/Kshot3000/MY-ERGO-DEX",
  "https://ergoplatform.org/", "https://explorer.ergoplatform.com/", "https://docs.ergoplatform.com/",
  "https://spectrum.fi/", "https://sigmausd.io/", "https://rosen.tech/", "https://app.rosen.tech/",
  "https://paideia.im/", "https://github.com/ergopad", "https://github.com/nautls/nautilus-wallet",
  "https://duckpools.io/", "https://skyharbor.io/", "https://mewfinance.com/", "https://fleet-sdk.github.io/docs/"
];
for (const url of LINKS) {
  check("catalogue linked: " + url, html.includes(url) && readme.includes(url));
}
check("Airlock labelled as my project", html.includes("My project") && html.includes("Airlock"));

/* Blake2b-256 known vectors (RFC 7693 / python hashlib) */
const hex = u => Buffer.from(u).toString("hex");
check("blake2b256 empty vector", hex(app.blake2b256(new Uint8Array(0))) === "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8");
check("blake2b256 abc vector", hex(app.blake2b256(new TextEncoder().encode("abc"))) === "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319");

/* address checker — valid vectors */
const kyle = app.checkErgoAddress(ERG);
check("Kyle's address valid", kyle.valid === true);
check("Kyle's address is mainnet P2PK", kyle.network === "Mainnet" && kyle.typeCode === 1 && kyle.prefix === 1);
check("Kyle's address content is a 33-byte key", kyle.contentBytes === 33);
check("documented mainnet P2PK valid", app.checkErgoAddress("9fRAWhdxEsTcdb8PhGNrZfwqa65zfkuYHAMmkQLcic1gdLSV5vA").valid === true);
const testnet = app.checkErgoAddress("3WvsT2Gm4EpsM9Pg18PdY6XyhNNMqXDsvJTbbf6ihLvAmSb7u5RN");
check("documented testnet P2PK valid", testnet.valid === true && testnet.network === "Testnet" && testnet.prefix === 0x11);
check("surrounding whitespace trimmed", app.checkErgoAddress("  " + ERG + " ").valid === true);

/* address checker — invalid vectors */
check("tampered last char fails checksum", app.checkErgoAddress("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvz").valid === false);
check("tampered middle char fails checksum", app.checkErgoAddress("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvx").valid === false);
check("non-Base58 char 0 rejected", app.checkErgoAddress("9fcM0RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy").valid === false);
check("non-Base58 char O rejected", app.checkErgoAddress("OfcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy").valid === false);
check("empty rejected", app.checkErgoAddress("").valid === false && app.checkErgoAddress(null).valid === false);
check("too short rejected", app.checkErgoAddress("9fc").valid === false);
check("inner space rejected", app.checkErgoAddress("9fcM5RWn AjmP4vx5").valid === false);
check("base58 garbage of plausible length rejected", app.checkErgoAddress("1111111111111111111111111111111111").valid === false);

/* converter — exactness */
check("1 ERG = 1e9 nanoERG", app.ergToNano("1") === "1000000000");
check("0 ERG = 0", app.ergToNano("0") === "0");
check("smallest unit exact", app.ergToNano("0.000000001") === "1");
check("fractional ERG exact", app.ergToNano("1.5") === "1500000000");
check("large ERG exact", app.ergToNano("97739925") === "97739925000000000");
check("10 decimals rejected", app.ergToNano("0.0000000001") === null);
check("junk rejected", app.ergToNano("abc") === null && app.ergToNano("") === null && app.ergToNano("-1") === null);
check("1 nanoERG back to ERG", app.nanoToErg("1") === "0.000000001");
check("1e9 nanoERG = 1 ERG", app.nanoToErg("1000000000") === "1");
check("1.5 ERG round trip", app.nanoToErg("1500000000") === "1.5");
check("fractional nanoERG rejected", app.nanoToErg("1.5") === null && app.nanoToErg("-5") === null);
check("round trip exact", app.nanoToErg(app.ergToNano("42.123456789")) === "42.123456789");
check("nano constant is 1e9", app.NANO_PER_ERG === 1000000000n);

console.log(failures === 0 ? "\nALL TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
