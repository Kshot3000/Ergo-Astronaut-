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
check("all main form controls labelled", ["q", "erg", "nanoerg", "addr-in", "rent-bytes", "rent-erg", "mine-hash", "mine-unit", "net-hash", "net-unit", "mine-reward", "minbox-bytes", "minbox-erg", "token-decimals", "token-raw", "token-display", "rentclock-created", "rentclock-current", "p2pk-pubkey", "p2pk-network", "payplan-boxes", "payplan-amount", "payplan-fee", "tree-hex", "tree-network", "addrtree-in", "babel-fee", "babel-price", "babel-decimals", "netconv-in", "boxid-bytes", "boxid-expected", "boxparse-bytes", "p2s-hex", "p2s-network", "boxbuild-value", "boxbuild-tree", "boxbuild-height", "boxbuild-tokens", "boxbuild-registers", "boxbuild-txid", "boxbuild-index", "sigma-hex", "sigma-spec", "treebuild-pubkey", "treebuild-network", "p2shbuild-hex", "p2shbuild-network", "hash-input", "hash-mode", "hash-expected"].every(id => html.includes(`for="${id}"`)));
check("cache keys present", html.includes("styles.css?v=3") && html.includes("app.js?v=21"));
check("storage rent tool on hub", html.includes('id="rent-calc"') && html.includes("1,250,000 nanoERG per byte"));
check("mining estimator on hub, no live-data claim", html.includes('id="mining-calc"') && html.includes("claims no live network data") && readme.includes("Autolykos mining-share estimator"));
check("min box value tool on hub", html.includes('id="minbox-calc"') && html.includes("360 nanoERG per byte") && readme.includes("Minimum box value checker"));
check("token converter tool on hub", html.includes('id="token-calc"') && html.includes("whole integers") && readme.includes("Token amount converter"));
check("rent countdown tool on hub, no live-data claim", html.includes('id="rent-clock-calc"') && html.includes("claims no live chain data") && readme.includes("Storage rent countdown"));
check("p2pk builder tool on hub", html.includes('id="p2pk-calc"') && html.includes("never type a private key") && readme.includes("P2PK address builder"));
check("payment planner tool on hub", html.includes('id="payplan-calc"') && html.includes("spends boxes whole") && readme.includes("UTXO payment planner"));
check("ergoTree inspector tool on hub", html.includes('id="tree-calc"') && html.includes("ErgoTree inspector") && readme.includes("ErgoTree inspector"));
check("address decoder tool on hub", html.includes('id="addrtree-calc"') && html.includes("one-way") && readme.includes("Address-to-ErgoTree decoder"));
check("babel fee tool on hub", html.includes('id="babel-calc"') && html.includes("nanoERG per raw token unit") && readme.includes("Babel fee calculator"));
check("network converter tool on hub", html.includes('id="netconv-calc"') && html.includes("separate worlds") && readme.includes("Address network converter"));
check("box id tool on hub", html.includes('id="boxid-calc"') && html.includes("Blake2b-256 of the box's serialized bytes") && readme.includes("Box ID calculator"));
check("box parser tool on hub", html.includes('id="boxparse-calc"') && html.includes("Serialized box parser") && readme.includes("Serialized box parser"));
check("p2s builder tool on hub", html.includes('id="p2s-calc"') && html.includes("P2S address builder") && readme.includes("P2S address builder"));
check("box builder tool on hub", html.includes('id="boxbuild-calc"') && html.includes("Serialized box builder") && readme.includes("Serialized box builder"));
check("sigma constant tool on hub", html.includes('id="sigma-calc"') && html.includes("Sigma constant inspector") && readme.includes("Sigma constant inspector"));
check("p2pk tree builder tool on hub", html.includes('id="treebuild-calc"') && html.includes("P2PK ErgoTree builder") && readme.includes("P2PK ErgoTree builder"));
check("p2sh builder tool on hub", html.includes('id="p2shbuild-calc"') && html.includes("P2SH address builder") && html.includes("can never be spent") && readme.includes("P2SH address builder"));
check("blake2b hash tool on hub", html.includes('id="hash-calc"') && html.includes("Blake2b-256 hash calculator") && html.includes("proves no ownership") && readme.includes("Blake2b-256 hash calculator"));
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

/* storage rent — protocol formula: bytes * storage_fee_factor (1,250,000
   nanoERG/byte, live mainnet param 2026-10-06), period 1,051,200 blocks */
check("rent factor constant", app.STORAGE_FEE_FACTOR_NANO_PER_BYTE === 1250000n);
check("rent period constant", app.STORAGE_PERIOD_BLOCKS === 1051200);
check("rent for 100-byte box", app.storageRentNano("100") === "125000000");
check("rent for 112-byte minimal box is 0.14 ERG", app.storageRentNano("112") === "140000000");
check("rent rejects junk", app.storageRentNano("0") === null && app.storageRentNano("-3") === null && app.storageRentNano("1.5") === null && app.storageRentNano("") === null);
const rich = app.analyzeStorageRent("112", "10");
check("10 ERG in 112-byte box covers 71 payments", rich.payments === "71" && rich.approxYears === "284" && rich.consumableAtFirstRent === false);
check("rent shown in ERG", rich.rentErg === "0.14" && rich.rentNano === "140000000");
const dust = app.analyzeStorageRent("112", "0.001");
check("0.001 ERG box consumable at first rent", dust.consumableAtFirstRent === true && dust.payments === "0");
const edge = app.analyzeStorageRent("112", "0.28");
check("exactly 2x rent covers exactly 1 payment", edge.payments === "1" && edge.consumableAtFirstRent === false);
check("rent analysis rejects junk", app.analyzeStorageRent("abc", "1") === null && app.analyzeStorageRent("112", "x") === null);

/* mining estimator — expectation maths: share of hashrate = share of the
   ~720 blocks/day at Ergo's 2-minute target; all figures user-supplied */
check("blocks-per-day constant is 720", app.BLOCKS_PER_DAY === 720);
check("hashrate unit conversions", app.hashrateToHps("1.5", "MH/s") === 1500000 && app.hashrateToHps("2", "TH/s") === 2e12 && app.hashrateToHps("500", "kH/s") === 500000 && app.hashrateToHps("1", "H/s") === 1);
check("hashrate rejects junk", app.hashrateToHps("0", "MH/s") === null && app.hashrateToHps("-1", "MH/s") === null && app.hashrateToHps("x", "MH/s") === null && app.hashrateToHps("1", "bogus") === null && app.hashrateToHps("", "MH/s") === null);
const close = (a, b) => Math.abs(a - b) < 1e-9;
const quarter = app.estimateMining(1e12, 4e12, "12");
check("25% share of hashrate", close(quarter.sharePercent, 25));
check("25% share expects 180 blocks/day", close(quarter.blocksPerDay, 180));
check("180 blocks at 12 ERG = 2160 ERG/day", close(quarter.ergPerDay, 2160));
check("days per block at 180/day", close(quarter.daysPerBlock, 1 / 180));
const solo = app.estimateMining(100e6, 10e12, "3");
check("tiny miner share", close(solo.sharePercent, 0.001) && close(solo.blocksPerDay, 0.0072) && close(solo.ergPerDay, 0.0216));
check("whole network is 100%", close(app.estimateMining(5, 5, "1").sharePercent, 100));
check("mining rejects miner above network", app.estimateMining(10, 5, "1") === null);
check("mining rejects zero/negative hashrate", app.estimateMining(0, 5, "1") === null && app.estimateMining(1, 0, "1") === null && app.estimateMining(null, 5, "1") === null);
check("mining rejects bad reward", app.estimateMining(1, 5, "0") === null && app.estimateMining(1, 5, "x") === null && app.estimateMining(1, 5, "") === null);
check("estimate formatting trims zeros", app.fmtEstimate(25) === "25" && app.fmtEstimate(2160) === "2160" && app.fmtEstimate(0.0216) === "0.0216");

/* minimum box value — protocol rule: value >= serialized bytes *
   minValuePerByte (360 nanoERG/byte, set at launch in sigma-rust
   BoxValue and still the live mainnet epoch param on 2026-10-07);
   safe user minimum 1,000,000 nanoERG covers boxes up to 2,777 bytes */
check("min-per-byte constant is 360", app.MIN_VALUE_PER_BYTE_NANO === 360n);
check("safe user min constant is 0.001 ERG", app.SAFE_USER_MIN_BOX_NANO === 1000000n);
check("min value for 100-byte box", app.minBoxValueNano("100") === "36000");
check("min value for 112-byte box is 0.00004032 ERG", app.minBoxValueNano("112") === "40320");
check("min value for 2777-byte box fits under safe min", app.minBoxValueNano("2777") === "999720");
check("min value rejects junk", app.minBoxValueNano("0") === null && app.minBoxValueNano("-3") === null && app.minBoxValueNano("1.5") === null && app.minBoxValueNano("") === null);
const exactMin = app.analyzeMinBoxValue("112", "0.00004032");
check("box at exactly its minimum passes", exactMin.meetsMinimum === true && exactMin.differenceNano === "0" && exactMin.minErg === "0.00004032" && exactMin.meetsSafeUserMin === false);
const belowMin = app.analyzeMinBoxValue("112", "0.00004");
check("box below minimum fails with shortfall", belowMin.meetsMinimum === false && belowMin.differenceNano === "320" && belowMin.differenceErg === "0.00000032");
const safeBox = app.analyzeMinBoxValue("112", "0.001");
check("0.001 ERG box clears both minimums", safeBox.meetsMinimum === true && safeBox.meetsSafeUserMin === true && safeBox.differenceNano === "959680");
check("min box analysis rejects junk", app.analyzeMinBoxValue("abc", "1") === null && app.analyzeMinBoxValue("112", "x") === null);

/* token converter — on-chain amounts are integers; display = raw / 10^decimals,
   exact both ways; ERG itself is the 9-decimal case (raw unit nanoERG) */
check("token decimals cap is 18", app.TOKEN_MAX_DECIMALS === 18);
check("parse token decimals", app.parseTokenDecimals("0") === 0 && app.parseTokenDecimals("9") === 9 && app.parseTokenDecimals("18") === 18);
check("parse token decimals rejects junk", app.parseTokenDecimals("19") === null && app.parseTokenDecimals("-1") === null && app.parseTokenDecimals("2.5") === null && app.parseTokenDecimals("") === null && app.parseTokenDecimals(null) === null);
check("raw to display at 2 decimals", app.tokenRawToDisplay("12345", "2") === "123.45");
check("raw to display trims trailing zeros", app.tokenRawToDisplay("100", "2") === "1" && app.tokenRawToDisplay("150", "2") === "1.5");
check("raw to display below one unit", app.tokenRawToDisplay("5", "2") === "0.05" && app.tokenRawToDisplay("0", "2") === "0");
check("raw to display at 0 decimals is identity", app.tokenRawToDisplay("777", "0") === "777");
check("raw to display matches nanoERG at 9 decimals", app.tokenRawToDisplay("1500000000", "9") === "1.5" && app.tokenRawToDisplay("1", "9") === "0.000000001");
check("raw to display rejects junk", app.tokenRawToDisplay("1.5", "2") === null && app.tokenRawToDisplay("-5", "2") === null && app.tokenRawToDisplay("", "2") === null && app.tokenRawToDisplay("100", "x") === null);
check("display to raw at 2 decimals", app.tokenDisplayToRaw("123.45", "2") === "12345");
check("display to raw whole amount", app.tokenDisplayToRaw("1", "2") === "100" && app.tokenDisplayToRaw("0.05", "2") === "5");
check("display to raw at 0 decimals", app.tokenDisplayToRaw("777", "0") === "777" && app.tokenDisplayToRaw("7.5", "0") === null);
check("display to raw rejects sub-raw-unit precision", app.tokenDisplayToRaw("0.001", "2") === null && app.tokenDisplayToRaw("1.234", "2") === null);
check("display to raw rejects junk", app.tokenDisplayToRaw("x", "2") === null && app.tokenDisplayToRaw("", "2") === null && app.tokenDisplayToRaw("-1", "2") === null && app.tokenDisplayToRaw("1", "99") === null);
check("token round trip exact", app.tokenDisplayToRaw(app.tokenRawToDisplay("987654321", "6"), "6") === "987654321" && app.tokenRawToDisplay(app.tokenDisplayToRaw("42.42", "4"), "4") === "42.42");

/* storage rent countdown — a box is rent-eligible at creation height +
   STORAGE_PERIOD_BLOCKS (1,051,200); days from the 720 blocks/day target */
check("parse chain height", app.parseChainHeight("0") === "0" && app.parseChainHeight(" 123 ") === "123" && app.parseChainHeight("1.5") === null && app.parseChainHeight("-1") === null && app.parseChainHeight("") === null && app.parseChainHeight(null) === null);
const fresh = app.analyzeRentCountdown("1000000", "1000000");
check("new box has full period remaining", fresh.ageBlocks === "0" && fresh.eligibilityHeight === "2051200" && fresh.eligible === false && fresh.blocksRemaining === "1051200");
check("full period is ~1460 days at target", close(fresh.approxDaysRemaining, 1460));
const halfway = app.analyzeRentCountdown("1000000", "1525600");
check("halfway box age and remaining", halfway.ageBlocks === "525600" && halfway.blocksRemaining === "525600" && halfway.eligible === false && close(halfway.approxDaysRemaining, 730));
const due = app.analyzeRentCountdown("0", "1051200");
check("box at eligibility height is eligible", due.eligible === true && due.blocksRemaining === "0" && due.approxDaysRemaining === 0 && due.eligibilityHeight === "1051200");
check("box past eligibility is eligible", app.analyzeRentCountdown("500", "2000000").eligible === true);
check("one block before eligibility is not eligible", app.analyzeRentCountdown("0", "1051199").eligible === false && app.analyzeRentCountdown("0", "1051199").blocksRemaining === "1");
check("countdown rejects current before creation", app.analyzeRentCountdown("100", "99") === null);
check("countdown rejects junk", app.analyzeRentCountdown("x", "100") === null && app.analyzeRentCountdown("100", "") === null && app.analyzeRentCountdown(null, null) === null);

/* P2PK address builder — address = prefix byte (0x01 mainnet / 0x11
   testnet, type 1) + 33-byte compressed key + first 4 bytes of
   Blake2b-256(prefix + key), Base58-encoded. Vectors: the documented
   mainnet/testnet P2PK addresses already used by the checker tests
   (keys recovered by decoding them), plus the fleet-sdk issue #219
   public key, cross-checked against an independent Python build
   (hashlib blake2b-256 + manual base58) on 2026-10-07. */
const KYLE_PK = "028fb2952e7373271f598b6a993038c4058e8d9f67f8f2a23ed6acfbc51446b455";
check("base58 encode round-trips Kyle's address", app.base58Encode(app.base58Decode(ERG)) === ERG);
check("base58 encode handles leading zero bytes", app.base58Encode(Uint8Array.from([0, 0, 1])) === "112" && app.base58Encode(new Uint8Array(0)) === "");
check("builder reproduces Kyle's mainnet address", app.p2pkAddressFromPublicKey(KYLE_PK, "mainnet") === ERG);
check("builder reproduces documented mainnet P2PK", app.p2pkAddressFromPublicKey("02764ea2b0b9b06b5730a4257bba71fd7797eb1ec12bc3ae6025a01d7fba53830e", "Mainnet") === "9fRAWhdxEsTcdb8PhGNrZfwqa65zfkuYHAMmkQLcic1gdLSV5vA");
check("builder reproduces documented testnet P2PK", app.p2pkAddressFromPublicKey("02229ac0a22560d7bdfa4eb1de64e688390e85339c08aaf018b22d5ce93593192f", "testnet") === "3WvsT2Gm4EpsM9Pg18PdY6XyhNNMqXDsvJTbbf6ihLvAmSb7u5RN");
check("builder fleet-issue key mainnet (python cross-check)", app.p2pkAddressFromPublicKey("03f2dab42d7333f37f527841998d5212468d0e7a0b7e091709501ed9be8e2fc7f3", "mainnet") === "9iJm5XdNBFk14jXE6CWfP3MAWgwA2oNXCPGiVddGzWnxpqZLhLT");
check("builder fleet-issue key testnet (python cross-check)", app.p2pkAddressFromPublicKey("03f2dab42d7333f37f527841998d5212468d0e7a0b7e091709501ed9be8e2fc7f3", "testnet") === "3WzPufJ2AduwbLwp5JWoQAZ99TuNWj918GMMfmB98eaBU87o7sxR");
const builtKyle = app.checkErgoAddress(app.p2pkAddressFromPublicKey(KYLE_PK, "mainnet"));
check("built address passes the checker", builtKyle.valid === true && builtKyle.network === "Mainnet" && builtKyle.typeCode === 1);
check("builder accepts uppercase hex and trims space", app.p2pkAddressFromPublicKey("  " + KYLE_PK.toUpperCase() + " ", "MAINNET") === ERG);
check("builder rejects uncompressed 04-prefixed key", app.p2pkAddressFromPublicKey("04" + KYLE_PK.slice(2) + "ab".repeat(32), "mainnet") === null);
check("builder rejects 33-byte key with wrong first byte", app.p2pkAddressFromPublicKey("05" + KYLE_PK.slice(2), "mainnet") === null);
check("builder rejects short/long/non-hex keys", app.p2pkAddressFromPublicKey("02ab", "mainnet") === null && app.p2pkAddressFromPublicKey(KYLE_PK + "ab", "mainnet") === null && app.p2pkAddressFromPublicKey("zz" + KYLE_PK.slice(2), "mainnet") === null && app.p2pkAddressFromPublicKey("", "mainnet") === null && app.p2pkAddressFromPublicKey(null, "mainnet") === null);
check("builder rejects unknown network", app.p2pkAddressFromPublicKey(KYLE_PK, "devnet") === null && app.p2pkAddressFromPublicKey(KYLE_PK, "") === null && app.p2pkAddressFromPublicKey(KYLE_PK, null) === null);

/* UTXO payment planner — eUTXO spends boxes whole: select in listed
   order until total >= payment + fee; change = selected - needed.
   Dust = change above zero but below SAFE_USER_MIN_BOX_NANO (tool 5). */
check("box list parses comma/space/newline separated ERG", JSON.stringify(app.parseBoxList("1, 0.5\n2")) === JSON.stringify(["1000000000", "500000000", "2000000000"]));
check("box list rejects junk", app.parseBoxList("1,x") === null && app.parseBoxList("") === null && app.parseBoxList("0") === null && app.parseBoxList("-1") === null && app.parseBoxList("1,,x") === null && app.parseBoxList(null) === null);
const plan1 = app.planPayment("0.5,0.5,0.5", "0.9", "0.001");
check("planner selects first boxes until covered", plan1.sufficient === true && plan1.selectedCount === 2 && plan1.unselectedCount === 1 && plan1.totalSelectedNano === "1000000000");
check("planner change is exact", plan1.changeNano === "99000000" && plan1.changeErg === "0.099" && plan1.changeIsDust === false && plan1.neededNano === "901000000");
const planExact = app.planPayment("1", "0.999", "0.001");
check("planner exact spend has zero change", planExact.sufficient === true && planExact.selectedCount === 1 && planExact.changeNano === "0" && planExact.changeIsDust === false);
const planShort = app.planPayment("0.1,0.1", "1", "0.001");
check("planner reports shortfall", planShort.sufficient === false && planShort.shortfallNano === "801000000" && planShort.shortfallErg === "0.801" && planShort.totalNano === "200000000");
const planDust = app.planPayment("1", "0.9985", "0.001");
check("planner flags dust change", planDust.sufficient === true && planDust.changeNano === "500000" && planDust.changeIsDust === true);
const planOrder = app.planPayment("0.1, 5", "1", "0.001");
check("planner respects listed order", planOrder.selectedCount === 2 && planOrder.totalSelectedNano === "5100000000" && planOrder.changeNano === "4099000000");
check("planner allows zero fee", app.planPayment("1", "1", "0").sufficient === true && app.planPayment("1", "1", "0").changeNano === "0");
check("planner rejects junk", app.planPayment("1", "0", "0.001") === null && app.planPayment("1", "x", "0.001") === null && app.planPayment("1", "0.5", "-0.1") === null && app.planPayment("", "0.5", "0.001") === null && app.planPayment(null, null, null) === null);

/* ErgoTree inspector — tree = [header][optional VLQ size][proposition]
   [optional segregated constants]; header flags 0x08 size, 0x10
   segregation. P2SH = prefix + first 24 bytes of Blake2b-256 over the
   PROPOSITION bytes + checksum. Reference vectors are the ones executed
   against sigmastate-interpreter in fleet-sdk/fleet#219 (the bug this
   guards against: hashing the full tree bytes instead), cross-checked
   with an independent Python (hashlib) build on 2026-10-07. */
const FLEET_PK = "03f2dab42d7333f37f527841998d5212468d0e7a0b7e091709501ed9be8e2fc7f3";
const P2PK_TREE = "0008cd" + FLEET_PK;
check("hex parsing", app.bytesToHex(app.hexToBytes("00ff10")) === "00ff10" && app.hexToBytes("0X0A") !== null && app.bytesToHex(app.hexToBytes("0x0a")) === "0a");
check("hex parsing rejects junk", app.hexToBytes("") === null && app.hexToBytes("abc") === null && app.hexToBytes("zz") === null && app.hexToBytes(null) === null && app.hexToBytes("0x") === null);
check("vlq size single byte", app.readVlqSize(Uint8Array.from([0x23, 0x00]), 0).value === 35 && app.readVlqSize(Uint8Array.from([0x23, 0x00]), 0).length === 1);
check("vlq size multi byte", app.readVlqSize(Uint8Array.from([0x80, 0x01]), 0).value === 128 && app.readVlqSize(Uint8Array.from([0x80, 0x01]), 0).length === 2);
check("vlq size truncated is null", app.readVlqSize(Uint8Array.from([0x80]), 0) === null && app.readVlqSize(new Uint8Array(0), 0) === null);
check("tree flag constants", app.ERGOTREE_SIZE_FLAG === 0x08 && app.ERGOTREE_SEGREGATION_FLAG === 0x10 && app.P2SH_HASH_BYTES === 24);
const treeMain = app.analyzeErgoTree(P2PK_TREE, "mainnet");
check("p2pk tree recognised on mainnet", treeMain.valid === true && treeMain.isP2PK === true && treeMain.publicKey === FLEET_PK && treeMain.propositionLength === 35 && treeMain.header === 0 && treeMain.sizeFlag === false && treeMain.segregated === false);
check("p2pk tree mainnet address matches builder", treeMain.address === "9iJm5XdNBFk14jXE6CWfP3MAWgwA2oNXCPGiVddGzWnxpqZLhLT");
check("p2pk tree testnet address matches builder", app.analyzeErgoTree(P2PK_TREE, "testnet").address === "3WzPufJ2AduwbLwp5JWoQAZ99TuNWj918GMMfmB98eaBU87o7sxR");
check("p2sh of p2pk script matches reference testnet vector", treeMain.p2shAddress !== null && app.analyzeErgoTree(P2PK_TREE, "testnet").p2shAddress === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("p2sh of p2pk script matches reference mainnet vector", treeMain.p2shAddress === "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9");
const treeSized = app.analyzeErgoTree("082308cd" + FLEET_PK, "testnet");
check("size-flagged tree skips vlq size", treeSized.valid === true && treeSized.sizeFlag === true && treeSized.declaredSize === 35 && treeSized.isP2PK === true && treeSized.p2shAddress === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("derived p2sh passes the address checker as P2SH", (() => { const c = app.checkErgoAddress(treeMain.p2shAddress); return c.valid === true && c.typeCode === 2 && c.network === "Mainnet" && c.contentBytes === 24; })());
check("derived p2pk address passes the checker", app.checkErgoAddress(treeMain.address).valid === true);
const SEG_TREE = "100604000e2003faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf040400040005000500d803d601e30004d602e4c6a70408d603e4c6a7050595e67201d804d604b2a5e4720100d605b2db63087204730000d606db6308a7d60799c1a7c17204d1968302019683050193c27204c2a7938c720501730193e4c672040408720293e4c672040505720393e4c67204060ec5a796830201929c998c7205029591b1720673028cb272067303000273047203720792720773057202";
const seg = app.analyzeErgoTree(SEG_TREE, "mainnet");
check("segregated tree reported, no address invented", seg.valid === true && seg.segregated === true && seg.address === null && seg.p2shAddress === null && /segregated/i.test(seg.reason));
check("generic script gets p2sh only", (() => { const g = app.analyzeErgoTree("00d803", "mainnet"); return g.valid === true && g.isP2PK === false && g.address === null && typeof g.p2shAddress === "string" && app.checkErgoAddress(g.p2shAddress).typeCode === 2; })());
check("tree inspector accepts uppercase and 0x prefix", app.analyzeErgoTree("0x" + P2PK_TREE.toUpperCase(), "MAINNET").address === treeMain.address);
check("tree inspector rejects size mismatch", app.analyzeErgoTree("082408cd" + FLEET_PK, "mainnet").valid === false);
check("tree inspector rejects reserved header bits", app.analyzeErgoTree("e008cd" + FLEET_PK, "mainnet").valid === false);
check("tree inspector rejects junk", app.analyzeErgoTree("", "mainnet").valid === false && app.analyzeErgoTree("zz", "mainnet").valid === false && app.analyzeErgoTree("00", "mainnet").valid === false && app.analyzeErgoTree(null, "mainnet").valid === false && app.analyzeErgoTree(P2PK_TREE, "devnet").valid === false && app.analyzeErgoTree(P2PK_TREE, null).valid === false);

/* Address -> ErgoTree decoder — content semantics per sigmastate /
   fleet-sdk ErgoAddress: P2PK content is the 33-byte key (tree =
   0008cd + key), P2SH content is the 24-byte proposition hash
   (one-way, no tree derived), P2S content is the full ErgoTree bytes
   verbatim. Vectors: Kyle's address + its known key, the fleet #219
   P2SH reference addresses (hash192 of 08cd + FLEET_PK computed
   independently above: 62d1e484…bf05d199), and fleet-sdk's
   fee-contract P2S address whose content is the segregated
   FEE_CONTRACT tree. */
const decKyle = app.decodeErgoAddress(ERG);
check("decoder reads Kyle's P2PK address", decKyle.valid === true && decKyle.network === "Mainnet" && decKyle.typeCode === 1 && decKyle.prefix === 1 && decKyle.contentBytes === 33);
check("decoder recovers Kyle's public key", decKyle.publicKey === KYLE_PK && decKyle.contentHex === KYLE_PK);
check("decoder rebuilds Kyle's ErgoTree", decKyle.ergoTree === "0008cd" + KYLE_PK);
check("decoded tree round-trips through the inspector", app.analyzeErgoTree(decKyle.ergoTree, "mainnet").address === ERG && app.analyzeErgoTree(decKyle.ergoTree, "mainnet").publicKey === KYLE_PK);
const decTestnet = app.decodeErgoAddress("3WvsT2Gm4EpsM9Pg18PdY6XyhNNMqXDsvJTbbf6ihLvAmSb7u5RN");
check("decoder reads testnet P2PK", decTestnet.valid === true && decTestnet.network === "Testnet" && decTestnet.publicKey === "02229ac0a22560d7bdfa4eb1de64e688390e85339c08aaf018b22d5ce93593192f" && decTestnet.ergoTree === "0008cd02229ac0a22560d7bdfa4eb1de64e688390e85339c08aaf018b22d5ce93593192f");
check("decoder trims surrounding whitespace", app.decodeErgoAddress("  " + ERG + " ").ergoTree === decKyle.ergoTree);
const P2SH_HASH192 = "62d1e48400494bfedf9bf70d4af152428fb46f32bf05d199";
const decP2shMain = app.decodeErgoAddress("7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9");
check("decoder reads mainnet P2SH reference", decP2shMain.valid === true && decP2shMain.typeCode === 2 && decP2shMain.prefix === 2 && decP2shMain.contentBytes === 24 && decP2shMain.scriptHash === P2SH_HASH192);
check("decoder derives no tree from a script hash", decP2shMain.ergoTree === null && decP2shMain.publicKey === null && /one-way/.test(decP2shMain.note));
check("decoded P2SH hash re-encodes to the same address", app.addressFromContent(0x02, app.hexToBytes(decP2shMain.scriptHash)) === "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9");
const decP2shTest = app.decodeErgoAddress("qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("decoder reads testnet P2SH reference", decP2shTest.valid === true && decP2shTest.network === "Testnet" && decP2shTest.prefix === 0x12 && decP2shTest.scriptHash === P2SH_HASH192 && app.addressFromContent(0x12, app.hexToBytes(decP2shTest.scriptHash)) === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("decoded hash matches inspector's P2SH derivation", app.bytesToHex(app.blake2b256(app.hexToBytes("08cd" + FLEET_PK)).subarray(0, 24)) === decP2shMain.scriptHash);
const FEE_CONTRACT_TREE = "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304";
const FEE_MAINNET_P2S = "2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe";
const decFee = app.decodeErgoAddress(FEE_MAINNET_P2S);
check("decoder reads fleet fee-contract P2S address", decFee.valid === true && decFee.typeCode === 3 && decFee.network === "Mainnet" && decFee.contentBytes === 105);
check("P2S content is the ErgoTree verbatim", decFee.ergoTree === FEE_CONTRACT_TREE && decFee.contentHex === FEE_CONTRACT_TREE);
check("fee tree parses as segregated, no P2SH invented", decFee.treeInfo !== null && decFee.treeInfo.segregated === true && decFee.treeInfo.p2shAddress === null && decFee.note === null);
check("decoded P2S content re-encodes to the same address", app.addressFromContent(0x03, app.hexToBytes(decFee.contentHex)) === FEE_MAINNET_P2S);
const malformedP2pk = app.addressFromContent(0x01, Uint8Array.from([1, 2, 3]));
const decMalformed = app.decodeErgoAddress(malformedP2pk);
check("checksum-valid but non-key P2PK content gets no tree", decMalformed.valid === true && decMalformed.typeCode === 1 && decMalformed.ergoTree === null && decMalformed.publicKey === null && /not a standard 33-byte public key/.test(decMalformed.note));
check("decoder rejects tampered address", app.decodeErgoAddress("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvz").valid === false && app.decodeErgoAddress("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvz").ergoTree === null);
check("decoder rejects junk", app.decodeErgoAddress("").valid === false && app.decodeErgoAddress(null).valid === false && app.decodeErgoAddress("9fc").valid === false && app.decodeErgoAddress("hello world").valid === false);

/* P2S address builder — the encode-side inverse of the decoder above:
   a P2S address's content is the full ErgoTree bytes verbatim under
   prefix 0x03 (mainnet) / 0x13 (testnet) plus the Blake2b-256
   checksum. Vectors: the fleet-sdk fee-contract P2S address on both
   networks (its testnet form is the converter vector below) and the
   fleet #219 P2PK tree, both cross-checked with an independent
   Python (hashlib) build before coding. */
const p2sFee = app.buildP2SAddress(FEE_CONTRACT_TREE, "mainnet");
check("p2s builder reproduces fleet fee-contract mainnet address", p2sFee.valid === true && p2sFee.address === FEE_MAINNET_P2S && p2sFee.byteLength === 105 && p2sFee.segregated === true && p2sFee.network === "Mainnet");
check("p2s builder fee-contract testnet matches python cross-check", app.buildP2SAddress(FEE_CONTRACT_TREE, "testnet").address === "Bf1X9JgQTUtgntaer91B24n6kP8L2kqEiQqNf1z97BKo9UbnW3WRP9VXu8BXd1LsYCiYbHJEdWKxkF5YNx5n7m31wsDjbEuB3B13ZMDVBWkepGmWfGa71otpFViHDCuvbw1uNicAQnfuWfnj8fbCa4");
check("p2s builder p2pk tree mainnet (python cross-check)", app.buildP2SAddress(P2PK_TREE, "mainnet").address === "fANwcV4PxwkDZcFtU7egw9Jz4Vt78wt3N6GrTPVbkB5pzgCrt1vukv9");
check("p2s builder p2pk tree testnet (python cross-check)", app.buildP2SAddress(P2PK_TREE, "testnet").address === "5AgXz2NSiMGc7vRex8QwZNpGxdLwMrgkF4EfRABufurSm72Tp7V6412H");
check("built p2s passes the checker as P2S", (() => { const c = app.checkErgoAddress(p2sFee.address); return c.valid === true && c.typeCode === 3 && c.network === "Mainnet" && c.contentBytes === 105; })());
check("built p2s round-trips through the decoder", app.decodeErgoAddress(app.buildP2SAddress(P2PK_TREE, "mainnet").address).ergoTree === P2PK_TREE);
check("p2s builder flags the p2pk proposition", app.buildP2SAddress(P2PK_TREE, "mainnet").isP2PK === true && p2sFee.isP2PK === false);
check("p2s address differs from the same script's p2sh", app.buildP2SAddress(P2PK_TREE, "mainnet").address !== app.analyzeErgoTree(P2PK_TREE, "mainnet").p2shAddress);
check("p2s builder tolerates whitespace, 0x and uppercase", app.buildP2SAddress(" 0X" + P2PK_TREE.toUpperCase() + " ", "mainnet").address === "fANwcV4PxwkDZcFtU7egw9Jz4Vt78wt3N6GrTPVbkB5pzgCrt1vukv9");
check("p2s builder rejects junk and bad networks", app.buildP2SAddress("zz", "mainnet").valid === false && app.buildP2SAddress("", "mainnet").valid === false && app.buildP2SAddress(P2PK_TREE, "mars").valid === false && app.buildP2SAddress(P2PK_TREE, "mars").address === null);

/* Babel fee calculator — a babel box's R5 register states its price in
   nanoERG per raw token unit; covering an ERG amount takes the ceiling
   of amount / price whole raw tokens, releasing tokens * price nanoERG.
   Decimals (tool 6) affect only the display form of the token count. */
check("babel price parses whole nanoERG", app.parseBabelPrice("1000") === "1000" && app.parseBabelPrice(" 1 ") === "1");
check("babel price rejects junk", app.parseBabelPrice("0") === null && app.parseBabelPrice("1.5") === null && app.parseBabelPrice("-5") === null && app.parseBabelPrice("") === null && app.parseBabelPrice(null) === null);
const babelExact = app.analyzeBabelFee("0.001", "1000", "2");
check("babel exact division needs no overhang", babelExact.tokensRaw === "1000" && babelExact.coveredNano === "1000000" && babelExact.excessNano === "0" && babelExact.coveredErg === "0.001");
check("babel display form uses the decimals", babelExact.tokensDisplay === "10" && babelExact.decimals === 2 && babelExact.feeErg === "0.001" && babelExact.priceNano === "1000");
const babelCeil = app.analyzeBabelFee("0.001", "300", "2");
check("babel rounds the token count up", babelCeil.tokensRaw === "3334" && babelCeil.coveredNano === "1000200" && babelCeil.excessNano === "200" && babelCeil.excessErg === "0.0000002");
check("babel ceiling display form", babelCeil.tokensDisplay === "33.34");
check("babel one token can cover a smaller fee", (() => { const r = app.analyzeBabelFee("0.001", "2000000", "0"); return r.tokensRaw === "1" && r.coveredNano === "2000000" && r.excessNano === "1000000" && r.tokensDisplay === "1"; })());
check("babel larger fee scales exactly", (() => { const r = app.analyzeBabelFee("2.1", "1000000", "9"); return r.tokensRaw === "2100" && r.coveredNano === "2100000000" && r.excessNano === "0"; })());
check("babel rejects junk", app.analyzeBabelFee("0", "1000", "2") === null && app.analyzeBabelFee("x", "1000", "2") === null && app.analyzeBabelFee("0.001", "0", "2") === null && app.analyzeBabelFee("0.001", "1.5", "2") === null && app.analyzeBabelFee("0.001", "1000", "19") === null && app.analyzeBabelFee(null, null, null) === null);

/* Address network converter — only the prefix byte's high nibble
   carries the network (0x0 mainnet, 0x1 testnet); the content is
   byte-identical on both networks and the checksum is recomputed over
   the new prefix + content. Vectors: the fleet #219 key's P2PK
   addresses are published on both networks (tool 8), as are the #219
   P2SH reference addresses (tool 10); Kyle's address and the
   fee-contract P2S conversion were cross-checked with an independent
   Python (hashlib) build. */
const convFleetM = app.convertAddressNetwork("9iJm5XdNBFk14jXE6CWfP3MAWgwA2oNXCPGiVddGzWnxpqZLhLT");
check("converter fleet mainnet P2PK -> known testnet address", convFleetM.valid === true && convFleetM.network === "Mainnet" && convFleetM.typeCode === 1 && convFleetM.convertedNetwork === "Testnet" && convFleetM.converted === "3WzPufJ2AduwbLwp5JWoQAZ99TuNWj918GMMfmB98eaBU87o7sxR" && convFleetM.contentHex === FLEET_PK);
check("converter testnet P2PK -> known mainnet address", app.convertAddressNetwork("3WzPufJ2AduwbLwp5JWoQAZ99TuNWj918GMMfmB98eaBU87o7sxR").converted === "9iJm5XdNBFk14jXE6CWfP3MAWgwA2oNXCPGiVddGzWnxpqZLhLT");
check("converter mainnet P2SH reference -> testnet reference", app.convertAddressNetwork("7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9").converted === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("converter testnet P2SH reference -> mainnet reference", app.convertAddressNetwork("qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i").converted === "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9");
check("converter Kyle mainnet -> testnet (python cross-check)", app.convertAddressNetwork(ERG).converted === "3WwhVfBuadPxyM9Evp6nqmKVA3Vax3AmUNZfLbqQoDQGugGD8BaP");
check("converter fee-contract P2S -> testnet (python cross-check)", app.convertAddressNetwork(FEE_MAINNET_P2S).converted === "Bf1X9JgQTUtgntaer91B24n6kP8L2kqEiQqNf1z97BKo9UbnW3WRP9VXu8BXd1LsYCiYbHJEdWKxkF5YNx5n7m31wsDjbEuB3B13ZMDVBWkepGmWfGa71otpFViHDCuvbw1uNicAQnfuWfnj8fbCa4");
check("converter round-trips on every type", [ERG, "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9", FEE_MAINNET_P2S].every((a) => app.convertAddressNetwork(app.convertAddressNetwork(a).converted).converted === a));
check("converted address passes the checker on the other network", (() => { const c = app.checkErgoAddress(app.convertAddressNetwork(ERG).converted); return c.valid === true && c.network === "Testnet" && c.typeCode === 1; })());
check("converter preserves the content bytes", app.convertAddressNetwork(ERG).contentHex === app.decodeErgoAddress(ERG).contentHex && app.convertAddressNetwork(FEE_MAINNET_P2S).contentHex === app.decodeErgoAddress(FEE_MAINNET_P2S).contentHex);
check("converter rejects tampered address", app.convertAddressNetwork("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvz").valid === false && app.convertAddressNetwork("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvz").converted === null);
check("converter rejects junk", app.convertAddressNetwork("").valid === false && app.convertAddressNetwork(null).valid === false && app.convertAddressNetwork("hello world").valid === false);

/* Box ID calculator — a box ID is the Blake2b-256 of the full
   serialized box bytes (candidate + creating tx ID + output index),
   the derivation fleet-sdk's ErgoBox.boxId / ErgoBox.validate use.
   Vectors are three of the fleet-sdk serializer's published box test
   vectors, cross-checked with an independent Python (hashlib) build
   on 2026-10-07: their serialized bytes reproduce their recorded box
   IDs exactly. A minted token's ID is the box ID of its creating
   transaction's first input. */
const BOX1 = "c0843d0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63cdee330150fdc80e168c153e472bd7e3dd18a4a0b9e90c550206fdbdb789ee8afdd3b1a90100ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee00";
const BOX1_ID = "135baecae94f7ec20caf981800166d450bd1dde4b959e5fdd0e2751b679d94dd";
const BOX2 = "c0843d0008cd02200a1c1b8fa17ec82de54bcaef96f23d7b34196c0410f6f578abdbf163b14b258abd33010cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b0100b66aab1e43874ad8c5583f685a7d6d947238c373f615aee1d04ee604ba2c934000";
const BOX2_ID = "69a2f4067392572ed355179f6b7c0e8f74fb8e34503926e6f836531e79ab13f5";
const BOX3 = "d68bb4440008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a6380ea30011fd6e032e8476c4aa54c18c1a308dce83940e8f4a28f576440513ed7326ad489fcf715008d210ec0a43662a397b1a35cf3091b246927eba1a51bae6696c8a640491eecd602";
const BOX3_ID = "809b5275a983aa188f376f5b3bffbc9ddaf19739a49f64467b15d47bc5369969";
check("box id fleet vector 1 (110 bytes)", (() => { const r = app.analyzeBoxId(BOX1, ""); return r.boxId === BOX1_ID && r.byteLength === 110 && r.expected === null && r.matches === null; })());
check("box id fleet vector 2 (110 bytes)", app.analyzeBoxId(BOX2, "").boxId === BOX2_ID && app.analyzeBoxId(BOX2, "").byteLength === 110);
check("box id fleet vector 3 (113 bytes)", app.analyzeBoxId(BOX3, "").boxId === BOX3_ID && app.analyzeBoxId(BOX3, "").byteLength === 113);
check("box id tolerates whitespace, 0x and uppercase", app.analyzeBoxId(" 0x" + BOX1.toUpperCase().slice(0, 100) + "\n" + BOX1.toUpperCase().slice(100) + " ", "").boxId === BOX1_ID);
check("box id expected match reported", (() => { const r = app.analyzeBoxId(BOX1, BOX1_ID); return r.matches === true && r.expected === BOX1_ID; })());
check("box id expected mismatch reported plainly", (() => { const r = app.analyzeBoxId(BOX1, BOX2_ID); return r.matches === false && r.boxId === BOX1_ID; })());
check("box id changes when one byte changes", app.analyzeBoxId(BOX1.slice(0, -2) + "01", "").boxId !== BOX1_ID);
check("box id rejects junk", app.analyzeBoxId("", "") === null && app.analyzeBoxId(null, null) === null && app.analyzeBoxId("abc", "") === null && app.analyzeBoxId("zz00", "") === null && app.analyzeBoxId("0x", "") === null);
check("box id rejects malformed expected id", app.analyzeBoxId(BOX1, "1234") === null && app.analyzeBoxId(BOX1, "z".repeat(64)) === null);

/* Serialized box parser — the field layout fleet-sdk's serializeBox /
   deserializeBox use: [value VLQ][ErgoTree][creation height VLQ]
   [token count VLQ + (32-byte ID + VLQ amount) per token][register
   count VLQ + Sigma constants][32-byte creating tx ID][index VLQ].
   Vectors are fleet-sdk's published box test vectors (their recorded
   fields AND box IDs must reproduce), plus two synthetic boxes built
   byte-by-byte for the size-flagged-tree and fee-contract paths and
   the register decoding (fleet's own register-bearing vector uses a
   segregated tree its deserializer refuses — mirrored below). Every
   expectation was cross-checked with an independent Python parser
   (hashlib) on 2026-10-07 before being written here. */
check("big vlq reads 64-bit amounts", (() => { const v = app.readVlqBig(app.hexToBytes("ffffffffffffffffff01"), 0); return v.value === 18446744073709551615n && v.length === 10; })());
check("big vlq rejects truncated/overlong", app.readVlqBig(app.hexToBytes("80"), 0) === null && app.readVlqBig(new Uint8Array(0), 0) === null);
check("zigzag decode", app.zigzagDecode(1705148n) === 852574n && app.zigzagDecode(1n) === -1n && app.zigzagDecode(2n) === 1n && app.zigzagDecode(0n) === 0n);
check("zigzag 32-bit decode truncates like fleet readI16/readI32", app.zigzagDecode32(18446744073709551614n) === 2147483647n && app.zigzagDecode32(18446744073709551615n) === -2147483648n && app.zigzagDecode32(65535n) === -32768n && app.zigzagDecode32(1705148n) === 852574n && app.zigzagDecode32(1n) === -1n);
const parsed1 = app.parseErgoBox(BOX1);
check("parser fleet vector 1 fields", parsed1.valid === true && parsed1.boxId === BOX1_ID && parsed1.byteLength === 110 && parsed1.valueNano === "1000000" && parsed1.valueErg === "0.001" && parsed1.creationHeight === 849741 && parsed1.index === 0 && parsed1.transactionId === "ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee");
check("parser fleet vector 1 tree and token", parsed1.ergoTree === "0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63" && parsed1.tokens.length === 1 && parsed1.tokens[0].tokenId === "50fdc80e168c153e472bd7e3dd18a4a0b9e90c550206fdbdb789ee8afdd3b1a9" && parsed1.tokens[0].amount === "1" && parsed1.registers.length === 0);
check("parser agrees with the box ID tool", parsed1.boxId === app.analyzeBoxId(BOX1, "").boxId);
check("parsed tree feeds the inspector", (() => { const t = app.analyzeErgoTree(parsed1.ergoTree, "mainnet"); return t.isP2PK === true && t.publicKey === "038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63"; })());
const parsed3 = app.parseErgoBox(BOX3);
check("parser fleet vector 3 fields", parsed3.valid === true && parsed3.boxId === BOX3_ID && parsed3.valueNano === "143459798" && parsed3.creationHeight === 800000 && parsed3.index === 2 && parsed3.tokens[0].amount === "359420" && parsed3.transactionId === "8d210ec0a43662a397b1a35cf3091b246927eba1a51bae6696c8a640491eecd6");
const BOX_NO_TOK = "c0843d0008cd0357ab5c00616362607d7d9e7000f35f4451a35dd99228b36a38f1461e4308e48480ea3000008d210ec0a43662a397b1a35cf3091b246927eba1a51bae6696c8a640491eecd600";
check("parser box with no tokens or registers", (() => { const p = app.parseErgoBox(BOX_NO_TOK); return p.valid === true && p.boxId === "321a7fffeb3ccde9c694b711e2ea2982ddcc39a97d41151513b07c6276711a51" && p.byteLength === 77 && p.tokens.length === 0 && p.registers.length === 0; })());
const BOX_24TOK = "caf0ca330008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a639fbf3318de5ee573c6a492c129d51119649bfeaedfc9afa6f54af576e62e1f7f3bbd42078e87f9f1051fd6e032e8476c4aa54c18c1a308dce83940e8f4a28f576440513ed7326ad4898a993d03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf043274251ce2cb4eb2024a1a155e19ad1d1f58ff8b9e6eb034a3bb1fd58802757d2380a0b787e905003bd19d0187117f130b62e1bcab0939929ff5c7709f843c5c4dd158949285d00136aba4b4a97b65be491cf9f5ca57b5408b0da8d0194f30ec8330d1e8946161c103c5d6629329285b14ed3eac1dba0e07dbd1e61ee332c2039a7a9c04e8be0cb74eb6f6b1c7ae03a3b3fa62124ef52209a46121e3f93ca98d7fc24198009e90fde8205ef9d3fc330100bd762484086cf560d3127eb53f0769d76244d9737636b2699d55c56cd470bfa589015a34d53ca483924b9a6aa0c771f11888881b516a8d1a9cdc535d063fe26d065e21d601123e8838b95cdaebe24e594276b2a89cd38e98add98405bb5327520ecf6cacf2cb07bf59773def7e08375a553be4cbd862de85f66e6dd3dccb8f87f53158f9255bf59582a6efc79e84911102f31739e2e4937bb9afb552943753d1e3e9cdd1a5e5661949cb0cef93f907eade9e0d30974274078845f263b4f21787e33cc99e9ec19a17ad85a5bc6da2cca91c5a2ec7c98b8c850b0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324bfc1c1c51c3a53abfe87e6db9a03c649e8360f255ffc4bd34303d30fc7db23ae551db9c04fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40c10fef802b475c06189fdbf844153cdc1d449a5ba87cce13d11bb47b5a539f27f12bfdecfad1f82a472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e880ade204bf2afb01fde7e373e22f24032434a7b883913bd87a23b62ee8b43eba53c9f6c201bf337a2ce726259ad31e043c5b3d432e31b403fc6686691171e0e0a319b9ae7a0100b1e236b60b95c2c6f8007a9d89bc460fc9e78f98b09faec9449007b40bccf3888124d71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413db0eee105e8290b090a773b7c56756507d45a76743d73bce54e8a915e95d9eb97360b681e596010089b758cfed2b9eac6721fb4576d8ba016202fdd939f32425aa7e2aefcbdde32e01";
const parsed24 = app.parseErgoBox(BOX_24TOK);
check("parser 24-token box (924 bytes)", parsed24.valid === true && parsed24.boxId === "6a83a25cc07a1bb7a0c763f94ede470010c8129ddfa248d8ce645ae5d7bb95d4" && parsed24.byteLength === 924 && parsed24.valueNano === "108181578" && parsed24.creationHeight === 843679 && parsed24.index === 1 && parsed24.tokens.length === 24);
check("parser 24-token box first and last tokens", parsed24.tokens[0].tokenId === "de5ee573c6a492c129d51119649bfeaedfc9afa6f54af576e62e1f7f3bbd4207" && parsed24.tokens[0].amount === "1581138830" && parsed24.tokens[23].tokenId === "ee105e8290b090a773b7c56756507d45a76743d73bce54e8a915e95d9eb97360" && parsed24.tokens[23].amount === "316227766");
check("parser reads a >64-bit-range token amount exactly", parsed24.tokens.some(tk => tk.tokenId === "bf59773def7e08375a553be4cbd862de85f66e6dd3dccb8f87f53158f9255bf5" && tk.amount === "1234567890123456789"));
const SYNTH_A = "80897a0806d191a304c801a0f7360150fdc80e168c153e472bd7e3dd18a4a0b9e90c550206fdbdb789ee8afdd3b1a92a0305cab4cd9a0304bc89680e20f7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee01";
const parsedA = app.parseErgoBox(SYNTH_A);
check("parser size-flagged tree box fields", parsedA.valid === true && parsedA.boxId === "cd46ba3fb988549c4be66b6e31eeeb8886ba377f6867bc368345ef43470219ce" && parsedA.byteLength === 126 && parsedA.valueNano === "2000000" && parsedA.ergoTree === "0806d191a304c801" && parsedA.creationHeight === 900000 && parsedA.index === 1 && parsedA.tokens[0].amount === "42");
check("parser decodes SLong and SInt registers", parsedA.registers.length === 3 && parsedA.registers[0].name === "R4" && parsedA.registers[0].type === "SLong" && parsedA.registers[0].value === "430550309" && parsedA.registers[0].rawHex === "05cab4cd9a03" && parsedA.registers[1].name === "R5" && parsedA.registers[1].type === "SInt" && parsedA.registers[1].value === "852574" && parsedA.registers[1].rawHex === "04bc8968");
check("parser decodes Coll[SByte] register", parsedA.registers[2].name === "R6" && parsedA.registers[2].type === "Coll[SByte]" && parsedA.registers[2].value === "0xf7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1" && parsedA.registers[2].rawHex === "0e20f7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1");
/* Regression (fixed 2026-10-07): fleet encodes SInt extremes as a
   64-bit-wide VLQ whose low 32 bits carry the zigzag; decoding it in
   64-bit space returned 9223372036854775807 for SInt max. The parser
   now decodes Short/Int through fleet's 32-bit zigzag, exactly like
   its readI16/readI32. Vector built byte-by-byte for this test and
   cross-checked against fleet's published constant vectors
   (04feffffffffffffffff01 = SInt max). */
const BOX_EXTREME = "80897a0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63a0f736000404feffffffffffffffff0104ffffffffffffffffff011002feffffffffffffffff01ffffffffffffffffff0103ffff03ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee00";
const parsedX = app.parseErgoBox(BOX_EXTREME);
check("parser decodes SInt extremes at fleet width", parsedX.valid === true && parsedX.boxId === "c2024c38602bdc5d7571989703d2292a7829e39a84a48b5f64c8aa7d4029b280" && parsedX.registers[0].type === "SInt" && parsedX.registers[0].value === "2147483647" && parsedX.registers[1].value === "-2147483648");
check("parser decodes Coll[SInt] extremes and SShort min", parsedX.registers[2].type === "Coll[SInt]" && parsedX.registers[2].value === "[2147483647, -2147483648]" && parsedX.registers[3].type === "SShort" && parsedX.registers[3].value === "-32768");
const SYNTH_B = "c0843d" + "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304" + "cdee330000ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee00";
check("parser fee-contract tree box", (() => { const p = app.parseErgoBox(SYNTH_B); return p.valid === true && p.boxId === "2bd17795c004f44c3530fe232707b781f3efdc135736ffe5bde7f6944b4207c0" && p.byteLength === 146 && p.ergoTree === app.FEE_CONTRACT_HEX && p.tokens.length === 0 && p.registers.length === 0 && p.creationHeight === 849741; })());
check("parser tolerates whitespace, 0x and uppercase", app.parseErgoBox(" 0x" + BOX1.toUpperCase().slice(0, 60) + "\n" + BOX1.toUpperCase().slice(60) + " ").boxId === BOX1_ID);
check("parser declines a no-size-flag segregated tree like fleet does", (() => { const p = app.parseErgoBox("c0843d1005040004000e36"); return p.valid === false && /no size field/.test(p.reason); })());
check("parser declines an exotic register constant plainly", (() => { const p = app.parseErgoBox("80897a0806d191a304c801a0f736000163ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee01"); return p.valid === false && /outside the set/.test(p.reason); })());
check("parser rejects truncated box", app.parseErgoBox(BOX1.slice(0, -4)).valid === false && app.parseErgoBox(BOX1.slice(0, 40)).valid === false);
check("parser rejects trailing bytes", (() => { const p = app.parseErgoBox(BOX1 + "00"); return p.valid === false && /extra byte/.test(p.reason); })());
check("parser rejects junk", app.parseErgoBox("").valid === false && app.parseErgoBox(null).valid === false && app.parseErgoBox("zz00").valid === false && app.parseErgoBox("abc").valid === false);

/* Serialized box builder — the encode-side inverse of the parser, in
   the layout fleet-sdk's serializeBox writes. The decisive checks
   rebuild fleet-sdk's published box vectors byte-for-byte from their
   recorded fields (the same fields the parser tests assert), and the
   register encoder is checked against fleet's published Sigma
   constant vectors — including the SInt 32-bit-extremes quirk, where
   fleet zigzags in signed 32-bit space and writes a negative result
   as its unsigned 64-bit form (04feffffffffffffffff01 for SInt max).
   Every expectation was cross-checked with an independent Python
   build on 2026-10-07 before being written here. */
check("vlq writer", JSON.stringify(app.writeVlqBig(0n)) === "[0]" && JSON.stringify(app.writeVlqBig(300n)) === "[172,2]" && JSON.stringify(app.writeVlqBig(18446744073709551615n)) === "[255,255,255,255,255,255,255,255,255,1]");
check("bigint sigma bytes are minimal two's complement", JSON.stringify(app.bigIntToSigmaBytes(0n)) === "[0]" && JSON.stringify(app.bigIntToSigmaBytes(-1n)) === "[255]" && JSON.stringify(app.bigIntToSigmaBytes(128n)) === "[0,128]" && JSON.stringify(app.bigIntToSigmaBytes(-129n)) === "[255,127]");
check("constant encoder fleet bool/byte/short vectors", app.encodeSigmaConstant("bool:true").rawHex === "0101" && app.encodeSigmaConstant("bool:false").rawHex === "0100" && app.encodeSigmaConstant("byte:-128").rawHex === "0280" && app.encodeSigmaConstant("byte:76").rawHex === "024c" && app.encodeSigmaConstant("short:-32768").rawHex === "03ffff03" && app.encodeSigmaConstant("short:17").rawHex === "0322");
check("constant encoder fleet int vectors incl. extremes quirk", app.encodeSigmaConstant("int:852574").rawHex === "04bc8968" && app.encodeSigmaConstant("int:2147483647").rawHex === "04feffffffffffffffff01" && app.encodeSigmaConstant("int:-2147483648").rawHex === "04ffffffffffffffffff01" && app.encodeSigmaConstant("int:-1").rawHex === "0401" && app.encodeSigmaConstant("int:65536").rawHex === "04808008");
check("constant encoder fleet long vectors", app.encodeSigmaConstant("long:430550309").rawHex === "05cab4cd9a03" && app.encodeSigmaConstant("long:9223372036854775807").rawHex === "05feffffffffffffffff01" && app.encodeSigmaConstant("long:-9223372036854775808").rawHex === "05ffffffffffffffffff01" && app.encodeSigmaConstant("long:960").rawHex === "05800f");
check("constant encoder fleet bigint vectors", app.encodeSigmaConstant("bigint:4").rawHex === "060104" && app.encodeSigmaConstant("bigint:1039").rawHex === "0602040f" && app.encodeSigmaConstant("bigint:12711077").rawHex === "060400c1f4a5" && app.encodeSigmaConstant("bigint:-518499127179672366370132270668500813").rawHex === "060f9c2404f2634ef40afccc320eed30b3");
check("constant encoder group and dlog", app.encodeSigmaConstant("group:038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63").rawHex === "07038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63" && app.encodeSigmaConstant("dlog:038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63").rawHex === "08cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63");
check("constant encoder collections", app.encodeSigmaConstant("bytes:f7ef73c4").rawHex === "0e04f7ef73c4" && app.encodeSigmaConstant("bytes:").rawHex === "0e00" && app.encodeSigmaConstant("ints:1,-1").rawHex === "10020201" && app.encodeSigmaConstant("longs:0,-1").rawHex === "11020001");
check("constant encoder rejects junk", app.encodeSigmaConstant("int:2147483648").valid === false && app.encodeSigmaConstant("byte:128").valid === false && app.encodeSigmaConstant("bool:yes").valid === false && app.encodeSigmaConstant("wat:1").valid === false && app.encodeSigmaConstant("nocolon").valid === false && app.encodeSigmaConstant("group:048d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63").valid === false && app.encodeSigmaConstant("bigint:" + (2n ** 260n).toString()).valid === false);
const TXID1 = "ae11d207f0989945f63909d2f703b2640acf4f654a8fdadd23570a640f9d12ee";
const built1 = app.buildErgoBox({ valueNano: "1000000", ergoTree: "0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63", creationHeight: "849741", tokens: [{ tokenId: "50fdc80e168c153e472bd7e3dd18a4a0b9e90c550206fdbdb789ee8afdd3b1a9", amount: "1" }], registers: [], transactionId: TXID1, index: "0" });
check("builder rebuilds fleet vector 1 byte-for-byte", built1.valid === true && built1.boxHex === BOX1 && built1.boxId === BOX1_ID && built1.byteLength === 110 && built1.registers.length === 0);
const built3 = app.buildErgoBox({ valueNano: "143459798", ergoTree: "0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63", creationHeight: "800000", tokens: [{ tokenId: "1fd6e032e8476c4aa54c18c1a308dce83940e8f4a28f576440513ed7326ad489", amount: "359420" }], registers: [], transactionId: "8d210ec0a43662a397b1a35cf3091b246927eba1a51bae6696c8a640491eecd6", index: "2" });
check("builder rebuilds fleet vector 3 byte-for-byte", built3.valid === true && built3.boxHex === BOX3 && built3.boxId === BOX3_ID);
const builtA = app.buildErgoBox({ valueNano: "2000000", ergoTree: "0806d191a304c801", creationHeight: "900000", tokens: [{ tokenId: "50fdc80e168c153e472bd7e3dd18a4a0b9e90c550206fdbdb789ee8afdd3b1a9", amount: "42" }], registers: ["long:430550309", "int:852574", "bytes:f7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1"], transactionId: TXID1, index: "1" });
check("builder rebuilds the synthetic register box byte-for-byte", builtA.valid === true && builtA.boxHex === SYNTH_A && builtA.boxId === "cd46ba3fb988549c4be66b6e31eeeb8886ba377f6867bc368345ef43470219ce" && builtA.registers.length === 3 && builtA.registers[2].type === "Coll[SByte]");
const builtB = app.buildErgoBox({ valueNano: "1000000", ergoTree: app.FEE_CONTRACT_HEX, creationHeight: "849741", tokens: [], registers: [], transactionId: TXID1, index: "0" });
check("builder rebuilds the fee-contract box", builtB.valid === true && builtB.boxHex === SYNTH_B && builtB.boxId === "2bd17795c004f44c3530fe232707b781f3efdc135736ffe5bde7f6944b4207c0");
const builtX = app.buildErgoBox({ valueNano: "2000000", ergoTree: "0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63", creationHeight: "900000", tokens: [], registers: ["bigint:-518499127179672366370132270668500813", "group:0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "dlog:0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "ints:1,-1,960", "longs:0,-1", "bool:true"], transactionId: TXID1, index: "3" });
check("builder round-trips every register kind", builtX.valid === true && builtX.registers.map(r => r.type).join(",") === "SBigInt,SGroupElement,SSigmaProp,Coll[SInt],Coll[SLong],SBoolean" && app.parseErgoBox(builtX.boxHex).boxId === builtX.boxId);
check("builder rejects bad fields", app.buildErgoBox({ valueNano: "0", ergoTree: "0008cd", creationHeight: "1", tokens: [], registers: [], transactionId: TXID1, index: "0" }).valid === false && app.buildErgoBox({ valueNano: "1000", ergoTree: "zz", creationHeight: "1", tokens: [], registers: [], transactionId: TXID1, index: "0" }).valid === false && app.buildErgoBox({ valueNano: "1000", ergoTree: "0008cd", creationHeight: "1", tokens: [{ tokenId: "abcd", amount: "1" }], registers: [], transactionId: TXID1, index: "0" }).valid === false && app.buildErgoBox({ valueNano: "1000", ergoTree: "0008cd", creationHeight: "1", tokens: [], registers: [], transactionId: "xyz", index: "0" }).valid === false && app.buildErgoBox({ valueNano: "1000", ergoTree: "0008cd", creationHeight: "1", tokens: [], registers: [], transactionId: TXID1, index: "65536" }).valid === false);
check("builder refuses seven registers and undelimitable trees", app.buildErgoBox({ valueNano: "1000", ergoTree: "0008cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63", creationHeight: "1", tokens: [], registers: ["bool:true", "bool:true", "bool:true", "bool:true", "bool:true", "bool:true", "bool:true"], transactionId: TXID1, index: "0" }).valid === false && app.buildErgoBox({ valueNano: "1000", ergoTree: "1005040004000e36", creationHeight: "1", tokens: [], registers: [], transactionId: TXID1, index: "0" }).valid === false);

/* Sigma constant inspector — one register standalone, decoded with the
   same reader tool 15 uses. Expectations are the register raw hexes the
   parser tests above already record, fleet-sdk's published constant
   vectors (the encoder tests), and the extremes the 14:31 fix covered. */
check("sigma decoder reads SLong and SInt registers", app.decodeSigmaConstant("05cab4cd9a03").type === "SLong" && app.decodeSigmaConstant("05cab4cd9a03").value === "430550309" && app.decodeSigmaConstant("05cab4cd9a03").byteLength === 6 && app.decodeSigmaConstant("04bc8968").type === "SInt" && app.decodeSigmaConstant("04bc8968").value === "852574");
check("sigma decoder reads Coll[SByte] register", app.decodeSigmaConstant("0e20f7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1").type === "Coll[SByte]" && app.decodeSigmaConstant("0e20f7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1").value === "0xf7ef73c4a4ab91b84bb0a2905108d534114472ec057be3a57a9dfc9b1fbd85c1");
check("sigma decoder reads SInt extremes at fleet width", app.decodeSigmaConstant("04feffffffffffffffff01").value === "2147483647" && app.decodeSigmaConstant("04ffffffffffffffffff01").value === "-2147483648");
check("sigma decoder reads bool, bigint, group and dlog", app.decodeSigmaConstant("0101").value === "true" && app.decodeSigmaConstant("0602040f").type === "SBigInt" && app.decodeSigmaConstant("0602040f").value === "0x040f" && app.decodeSigmaConstant("07038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63").type === "SGroupElement" && app.decodeSigmaConstant("08cd038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63").value.indexOf("proveDlog(038d") === 0);
check("sigma decoder reads collections", app.decodeSigmaConstant("10020201").type === "Coll[SInt]" && app.decodeSigmaConstant("10020201").value === "[1, -1]" && app.decodeSigmaConstant("11020001").type === "Coll[SLong]" && app.decodeSigmaConstant("0e00").value === "0x");
check("sigma decoder tolerates whitespace, 0x and uppercase", app.decodeSigmaConstant(" 0x05CAB4CD9A03 ").valid === true && app.decodeSigmaConstant(" 0x05CAB4CD9A03 ").rawHex === "05cab4cd9a03");
check("sigma round-trip: every encodable kind decodes back", ["bool:true", "byte:-5", "short:-32768", "int:2147483647", "long:430550309", "bigint:1039", "group:038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63", "dlog:038d39af8c37583609ff51c6a577efe60684119da2fbd0d75f9c72372886a58a63", "bytes:f7ef73c4", "ints:1,-1,960", "longs:0,-1"].every(spec => { const e = app.encodeSigmaConstant(spec); const d = app.decodeSigmaConstant(e.rawHex); return e.valid && d.valid && d.type === e.typeName && d.value === e.value; }));
check("sigma decoder agrees with the box parser on a register", (() => { const p = app.parseErgoBox(SYNTH_A); const d = app.decodeSigmaConstant(p.registers[0].rawHex); return d.valid && d.type === p.registers[0].type && d.value === p.registers[0].value; })());
check("sigma decoder rejects trailing bytes and junk", app.decodeSigmaConstant("05cab4cd9a03ff").valid === false && /extra byte/.test(app.decodeSigmaConstant("05cab4cd9a03ff").reason) && app.decodeSigmaConstant("").valid === false && app.decodeSigmaConstant("zz").valid === false && app.decodeSigmaConstant("05cab4").valid === false);
check("sigma decoder declines an unsupported type plainly", app.decodeSigmaConstant("2400").valid === false && /outside the set/.test(app.decodeSigmaConstant("2400").reason));

/* P2PK ErgoTree builder — the tree is header 0x00 + the ProveDlog
   proposition (08 cd) + the key, the construction tool 11's decoder
   reverses and sigmastate builds for P2PK scripts. FLEET_PK is the
   fleet-sdk/fleet#219 reference key: its P2SH addresses are the
   independently executed sigmastate vectors, and its P2PK addresses
   are the Python-cross-checked vectors from the tool 8/13 tests. */
const FLEET_TREE = "0008cd" + FLEET_PK;
const builtTreeMain = app.buildP2PKTree(FLEET_PK, "mainnet");
check("tree builder builds the standard P2PK tree", builtTreeMain.valid === true && builtTreeMain.treeHex === FLEET_TREE && builtTreeMain.publicKey === FLEET_PK && builtTreeMain.network === "Mainnet");
check("tree builder mainnet addresses match the reference vectors", builtTreeMain.address === "9iJm5XdNBFk14jXE6CWfP3MAWgwA2oNXCPGiVddGzWnxpqZLhLT" && builtTreeMain.p2shAddress === "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9");
const builtTreeTest = app.buildP2PKTree(FLEET_PK, "testnet");
check("tree builder testnet: same tree, network addresses", builtTreeTest.valid === true && builtTreeTest.treeHex === FLEET_TREE && builtTreeTest.address === "3WzPufJ2AduwbLwp5JWoQAZ99TuNWj918GMMfmB98eaBU87o7sxR" && builtTreeTest.p2shAddress === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("tree builder agrees with tools 10 and 11 both ways", app.analyzeErgoTree(builtTreeMain.treeHex, "mainnet").publicKey === FLEET_PK && app.decodeErgoAddress(builtTreeMain.address).ergoTree === FLEET_TREE && (() => { const k = app.decodeErgoAddress("9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy"); return k.valid && app.buildP2PKTree(k.publicKey, "mainnet").treeHex === k.ergoTree; })());
check("tree builder tolerates 0x, uppercase and whitespace", app.buildP2PKTree(" 0x" + FLEET_PK.toUpperCase() + " ", "Mainnet").treeHex === FLEET_TREE);
check("tree builder rejects bad keys and networks plainly", app.buildP2PKTree("", "mainnet").valid === false && app.buildP2PKTree("02ab", "mainnet").valid === false && app.buildP2PKTree("04" + FLEET_PK.slice(2), "mainnet").valid === false && /uncompressed/.test(app.buildP2PKTree("04" + FLEET_PK.slice(2), "mainnet").reason) && app.buildP2PKTree(FLEET_PK, "devnet").valid === false && app.buildP2PKTree(FLEET_PK.slice(0, 64) + "zz", "mainnet").valid === false);

/* P2SH address builder — the dedicated form of tool 10's derivation:
   prefix 0x02/0x12 + first 24 bytes of Blake2b-256 over the
   PROPOSITION (header and any VLQ size field stripped) + checksum.
   Vectors are the fleet-sdk/fleet#219 sigmastate reference addresses
   plus a generic script, all cross-checked with an independent
   Python (hashlib) build before coding; the segregated fee-contract
   tree must be refused, exactly as fleet PR #220 refuses it. */
const p2shMain = app.buildP2SHAddress(P2PK_TREE, "mainnet");
check("p2sh builder reproduces the reference mainnet vector", p2shMain.valid === true && p2shMain.address === "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9" && p2shMain.scriptHash === P2SH_HASH192 && p2shMain.propositionHex === "08cd" + FLEET_PK && p2shMain.isP2PK === true && p2shMain.network === "Mainnet");
check("p2sh builder reproduces the reference testnet vector", app.buildP2SHAddress(P2PK_TREE, "testnet").address === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i");
check("p2sh builder hashes the proposition, not the full tree", p2shMain.address !== "791ufyhDHbhs75eFQyRMQKXQ9hpa6iFFpDKZNV4" && p2shMain.scriptHash !== "54cbbd0ee5a0d5659446258e67dab5ae6be2f4b4de1c7172");
check("p2sh builder size-flagged tree gives the same address", app.buildP2SHAddress("082308cd" + FLEET_PK, "testnet").address === "qQqAgn6N6hrNTTu2s19HJg52NK37GENqoeo2W6i" && app.buildP2SHAddress("082308cd" + FLEET_PK, "testnet").propositionHex === "08cd" + FLEET_PK);
check("p2sh builder generic script (python cross-check)", app.buildP2SHAddress("00d803", "mainnet").address === "6JVXqX9fBNnEKEvsew6FCFU4FEegahLmT4VGo17" && app.buildP2SHAddress("00d803", "testnet").address === "pRwZihmDA2mF1nFFkrF1DZMFUgpuk9KBLvuZQsy" && app.buildP2SHAddress("00d803", "mainnet").scriptHash === "0374603ab56189811d8a25ce80cb54e9c91a25adb95a6bc4");
check("built p2sh passes the checker and round-trips through the decoder", (() => { const c = app.checkErgoAddress(p2shMain.address); const d = app.decodeErgoAddress(p2shMain.address); return c.valid === true && c.typeCode === 2 && d.scriptHash === p2shMain.scriptHash; })());
check("p2sh builder agrees with the inspector and the tree builder", p2shMain.address === app.analyzeErgoTree(P2PK_TREE, "mainnet").p2shAddress && p2shMain.address === builtTreeMain.p2shAddress);
check("p2sh builder refuses segregated trees plainly", app.buildP2SHAddress(FEE_CONTRACT_TREE, "mainnet").valid === false && app.buildP2SHAddress(FEE_CONTRACT_TREE, "mainnet").address === null && /Constant-segregated/.test(app.buildP2SHAddress(FEE_CONTRACT_TREE, "mainnet").reason) && app.buildP2SHAddress(SEG_TREE, "mainnet").valid === false);
check("p2sh builder tolerates whitespace, 0x and uppercase", app.buildP2SHAddress(" 0X" + P2PK_TREE.toUpperCase() + " ", "Mainnet").address === "7HP8obUp83sMkvaem5zXHNBq8rrt6nQRukXFYY9");
check("p2sh builder rejects junk, bad networks and size mismatches", app.buildP2SHAddress("zz", "mainnet").valid === false && app.buildP2SHAddress("", "mainnet").valid === false && app.buildP2SHAddress(P2PK_TREE, "mars").valid === false && app.buildP2SHAddress("082408cd" + FLEET_PK, "mainnet").valid === false && app.buildP2SHAddress(P2PK_TREE, "mars").address === null);

/* Blake2b-256 hash calculator — the primitive behind box IDs
   (tool 14), address checksums and the P2SH hash192. All digests are
   Python hashlib (blake2b, digest_size=32) vectors computed before
   coding; the proposition vector's digest must start with the fleet
   #219 script hash the P2SH tests already pin. */
check("blake2b hex abc matches the python vector", app.analyzeBlake2b("616263", "hex", "").digest === "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319" && app.analyzeBlake2b("616263", "hex", "").byteLength === 3);
check("blake2b text mode hashes the utf-8 bytes", app.analyzeBlake2b("abc", "text", "").digest === app.analyzeBlake2b("616263", "hex", "").digest && app.analyzeBlake2b("hello ergo", "text", "").digest === "0a51a581cbb3000b8943585369a4848ca921271606342dc4ad73da38bff52355");
check("blake2b empty input is hashed, not rejected", app.analyzeBlake2b("", "hex", "").digest === "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8" && app.analyzeBlake2b("", "text", "").digest === "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8" && app.analyzeBlake2b("", "hex", "").byteLength === 0);
check("blake2b proposition digest starts with the fleet script hash", (() => { const r = app.analyzeBlake2b("08cd" + FLEET_PK, "hex", ""); return r.digest === "62d1e48400494bfedf9bf70d4af152428fb46f32bf05d19907b6fe958144d101" && r.hash192 === P2SH_HASH192; })());
check("blake2b agrees with the box id tool", app.analyzeBlake2b(BOX1, "hex", "").digest === BOX1_ID && app.analyzeBlake2b("00", "hex", "").digest === "03170a2e7597b7b7e3d84c05391d139a62b157e78786d8c082f29dcf4c111314");
check("blake2b expected match and mismatch reported", app.analyzeBlake2b("616263", "hex", "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319").matches === true && app.analyzeBlake2b("616263", "hex", BOX1_ID).matches === false && app.analyzeBlake2b("616263", "hex", "").matches === null);
check("blake2b tolerates whitespace, 0x and uppercase in hex mode", app.analyzeBlake2b(" 0x61 6263\n", "HEX", "").digest === "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319");
check("blake2b rejects junk plainly", app.analyzeBlake2b("abc", "hex", "") === null && app.analyzeBlake2b("zz", "hex", "") === null && app.analyzeBlake2b("616263", "base64", "") === null && app.analyzeBlake2b("616263", "hex", "abcd") === null && app.analyzeBlake2b(null, null, null) === null);

console.log(failures === 0 ? "\nALL TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
