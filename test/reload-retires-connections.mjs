// A config reload must retire every HTTP/2 connection the old server owns.
//
// The connection under test is accepted by the old server but finishes its TLS
// handshake only after the reload, which is the window patches/0001 closes.
// Unpatched, it never receives a GOAWAY and answers from the superseded config
// for as long as the client keeps it open.
import net from "node:net";
import tls from "node:tls";
import http2 from "node:http2";

const HOST = process.env.CADDY_HOST ?? "caddy-under-test";
const ADMIN = `http://${HOST}:2019`;

function config(body) {
	return {
		admin: { listen: "0.0.0.0:2019", origins: [`${HOST}:2019`, ADMIN] },
		apps: {
			http: {
				servers: {
					srv0: {
						listen: [":8443"],
						automatic_https: { disable_redirects: true },
						tls_connection_policies: [{}],
						routes: [{ handle: [{ handler: "static_response", body }] }],
					},
				},
			},
			tls: {
				certificates: { automate: ["localhost"] },
				automation: { policies: [{ subjects: ["localhost"], issuers: [{ module: "internal" }] }] },
			},
		},
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load(body) {
	const res = await fetch(`${ADMIN}/load`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ADMIN },
		body: JSON.stringify(config(body)),
	});
	if (!res.ok) throw new Error(`load ${body}: ${res.status} ${await res.text()}`);
}

async function stuckShutdowns() {
	const res = await fetch(`${ADMIN}/debug/pprof/goroutine?debug=1`, { headers: { Origin: ADMIN } });
	let n = 0;
	for (const g of (await res.text()).split(/\n\n+/)) {
		if (/^\d+ @/.test(g.trim()) && g.includes("net/http.(*Server).Shutdown")) n += Number(g.trim().split(" ")[0]);
	}
	return n;
}

function rawTcp() {
	return new Promise((resolve, reject) => {
		const s = net.connect(8443, HOST, () => resolve(s));
		s.once("error", reject);
	});
}

function connectTls(socket) {
	return new Promise((resolve, reject) => {
		const s = tls.connect({ socket, host: HOST, servername: "localhost", ALPNProtocols: ["h2"], rejectUnauthorized: false });
		s.once("secureConnect", () => resolve(s));
		s.once("error", reject);
	});
}

function session(socket) {
	const s = http2.connect("https://localhost", { createConnection: () => socket });
	s.goaways = 0;
	s.on("goaway", () => s.goaways++);
	s.on("error", () => {});
	return s;
}

function get(s) {
	return new Promise((resolve) => {
		if (s.closed || s.destroyed) return resolve("closed");
		let body = "";
		let req;
		try {
			req = s.request({ ":path": "/" });
		} catch {
			return resolve("closed");
		}
		req.setEncoding("utf8");
		req.on("data", (d) => (body += d));
		req.on("end", () => resolve(body));
		req.on("error", () => resolve("closed"));
		req.setTimeout(3000, () => {
			req.close();
			resolve("timeout");
		});
		req.end();
	});
}

const failures = [];
const expect = (ok, message) => {
	console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
	if (!ok) failures.push(message);
};

for (let attempt = 0; ; attempt++) {
	try {
		await load("old");
		break;
	} catch (err) {
		if (attempt >= 40) throw err;
		await sleep(250);
	}
}
await sleep(1000);

const established = session(await connectTls(await rawTcp()));
expect((await get(established)) === "old", "a connection serves the loaded config");

const pending = await rawTcp();
await sleep(300);
await load("new");
await sleep(500);
const late = session(await connectTls(pending));
const fresh = session(await connectTls(await rawTcp()));

const lateBodies = [];
const freshBodies = [];
for (let i = 0; i < 4; i++) {
	lateBodies.push(await get(late));
	freshBodies.push(await get(fresh));
	await sleep(500);
}

expect(established.goaways === 1, "a connection established before the reload receives a GOAWAY");
expect(late.goaways === 1, "a connection whose handshake finished after the reload receives a GOAWAY");
expect(
	lateBodies.filter((b) => b === "old").length <= 1,
	`that connection answers at most one request from the old config (got ${JSON.stringify(lateBodies)})`,
);
expect(freshBodies.every((b) => b === "new"), `a new connection serves the new config (got ${JSON.stringify(freshBodies)})`);
expect(fresh.goaways === 0, "a connection to the live server is never sent a GOAWAY");
expect((await stuckShutdowns()) === 0, "no superseded server is left waiting on a connection");

process.exit(failures.length === 0 ? 0 : 1);
