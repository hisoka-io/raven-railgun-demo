#!/usr/bin/env node
// Recording proxy between a wallet and its two POI upstreams (a Raven node and the PPOI
// aggregator). Bytes are forwarded unchanged; each exchange is recorded, checked for the
// watched note commitments, streamed to the observer page over SSE and written to a JSON log.
// Each upstream gets its own listen port: the SDK refuses a pin source that shares the Raven
// endpoint's origin, so one port for both would turn pin verification off.

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export const LOG_FORMAT = "raven-observer-log";
export const LOG_VERSION = 1;

const PREVIEW_TEXT_CHARS = 1600;
const PREVIEW_BINARY_BYTES = 48;
const PREFIX_BYTES = 6;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
// Only these request headers are recorded; a credential must never reach the log.
const RECORDED_REQUEST_HEADERS = ["content-type", "x-raven-client-id", "user-agent"];
const RECORDED_RESPONSE_HEADERS = [
  "content-type",
  "x-raven-session",
  "x-raven-freshness",
  "x-raven-index-next",
  "x-raven-index-total",
  "x-raven-epoch",
];

export function normalizeCommitment(raw) {
  const s = String(raw).trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,64}$/.test(s)) return null;
  return s.padStart(64, "0");
}

export function needleFor(hex) {
  const be = Buffer.from(hex, "hex");
  const le = Buffer.from(be).reverse();
  const stripped = hex.replace(/^0+/, "");
  return {
    hex,
    // A shorter stripped form would match unrelated hex; such a value is not a real commitment.
    strippedHex: stripped.length >= 32 ? stripped : hex,
    decimal: BigInt(`0x${hex}`).toString(10),
    be,
    le,
    prefixBytes: be.subarray(0, PREFIX_BYTES),
    prefixHex: hex.slice(0, PREFIX_BYTES * 2),
    // A short prefix is only evidence when it is high-entropy; a value like 10 00 00 00 00 00
    // occurs in any binary body as a length field.
    prefixUsable: new Set(be.subarray(0, PREFIX_BYTES)).size >= 5,
  };
}

/** Every encoding of every watched commitment found in `buf` (and `url`). Prefix forms are
 *  checked on requests only: the list index a server hands out is prefixes by design. */
export function scanForCommitments(needles, buf, { url = "", request = true } = {}) {
  if (needles.length === 0) return [];
  const text = (url + "\n" + buf.toString("latin1")).toLowerCase();
  const found = [];
  for (const n of needles) {
    const encodings = [];
    if (text.includes(n.strippedHex)) encodings.push("hex");
    if (n.decimal.length >= 20 && text.includes(n.decimal)) encodings.push("decimal");
    if (buf.indexOf(n.be) !== -1) encodings.push("bytes-be");
    if (buf.indexOf(n.le) !== -1) encodings.push("bytes-le");
    if (request && n.prefixUsable && encodings.length === 0) {
      if (text.includes(n.prefixHex)) encodings.push("prefix6-hex");
      if (buf.indexOf(n.prefixBytes) !== -1) encodings.push("prefix6-bytes");
    }
    if (encodings.length > 0) found.push({ commitment: n.hex, encodings });
  }
  return found;
}

function decodeForScan(buf, encoding) {
  try {
    switch ((encoding ?? "").toLowerCase()) {
      case "gzip":
      case "x-gzip":
        return gunzipSync(buf);
      case "deflate":
        return inflateSync(buf);
      case "br":
        return brotliDecompressSync(buf);
      default:
        return buf;
    }
  } catch {
    return buf;
  }
}

function looksTextual(contentType, buf) {
  if (/json|text|javascript|xml|x-www-form/.test(contentType ?? "")) return true;
  const head = buf.subarray(0, 64);
  for (const b of head) {
    if (b < 9 || (b > 13 && b < 32) || b > 126) return false;
  }
  return head.length > 0;
}

function preview(buf, contentType) {
  if (buf.length === 0) return { kind: "empty", text: "" };
  if (looksTextual(contentType, buf)) {
    const text = buf.toString("utf8");
    return {
      kind: "text",
      text: text.length > PREVIEW_TEXT_CHARS ? `${text.slice(0, PREVIEW_TEXT_CHARS)}...` : text,
      truncated: text.length > PREVIEW_TEXT_CHARS,
    };
  }
  return {
    kind: "binary",
    text: buf.subarray(0, PREVIEW_BINARY_BYTES).toString("hex"),
    truncated: buf.length > PREVIEW_BINARY_BYTES,
  };
}

const NOTE_READS = new Set([
  "ppoi_pois_per_list",
  "ppoi_merkle_proofs",
  "ppoi_pois_per_blinded_commitment",
]);

/** Blinded commitments an aggregator request names in the clear, as the wallet sent them: the
 *  notes of a status or path read, or the new notes a proof submission publishes. The latter are
 *  the notes the wallet's next status refresh asks about, so watching them checks that refresh. */
export function commitmentsNamedBy(buf) {
  try {
    const { method, params } = JSON.parse(buf.toString("utf8"));
    if (!params) return { origin: undefined, list: [] };
    if (method === "ppoi_submit_transact_proof") {
      const out = params.transactProofData?.blindedCommitmentsOut ?? [];
      return { origin: "proof output", list: out.filter((c) => typeof c === "string") };
    }
    if (!NOTE_READS.has(method)) return { origin: undefined, list: [] };
    const fromData = (params.blindedCommitmentDatas ?? []).map((d) => d?.blindedCommitment);
    const direct = params.blindedCommitments ?? [];
    const single = params.blindedCommitmentData?.blindedCommitment;
    return {
      origin: "read",
      list: [...fromData, ...direct, single].filter((c) => typeof c === "string"),
    };
  } catch {
    return { origin: undefined, list: [] };
  }
}

function jsonRpcMethod(buf) {
  if (buf.length === 0 || buf[0] !== 0x7b) return undefined;
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    return typeof parsed?.method === "string" ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}

const BATCH_HEADER_BYTES = 10;

/** What a `/batch` body carries in the clear: `[u16 BE schema][u64 LE count]`, then the queries,
 *  each led by its u32 LE shard id. Queries in one batch share a session and parameters, so they
 *  are the same length; when the body does not divide evenly the shard ids are left out. */
export function decodeBatchEnvelope(buf) {
  if (buf.length < BATCH_HEADER_BYTES + 4) return undefined;
  const count = buf.readBigUInt64LE(2);
  const payload = buf.length - BATCH_HEADER_BYTES;
  if (count < 1n || count > BigInt(Math.floor(payload / 4))) return undefined;
  const queries = Number(count);
  if (payload % queries !== 0) return { queries };
  const stride = payload / queries;
  const shardIds = Array.from({ length: queries }, (_, i) =>
    buf.readUInt32LE(BATCH_HEADER_BYTES + i * stride),
  );
  return { queries, shardIds };
}

/** Route shape with identifiers lifted out, so the page can group and explain requests. */
export function describeRoute(upstream, path, rpcMethod) {
  if (upstream === "aggregator") {
    return { template: rpcMethod ?? path, block: undefined };
  }
  const bare = path.split("?")[0];
  let m = bare.match(/^\/v1\/instance\/([^/]+)\/(batch|query|session|params|fanout)$/);
  if (m) return { template: `/v1/instance/{id}/${m[2]}`, block: decodeURIComponent(m[1]) };
  m = bare.match(/^\/v1\/poi\/([0-9a-fA-F]+)\/bc-prefixes$/);
  if (m) return { template: "/v1/poi/{listKey}/bc-prefixes", block: undefined };
  return { template: bare, block: undefined };
}

function pickHeaders(headers, names) {
  const out = {};
  for (const name of names) {
    const v = headers[name];
    if (v !== undefined) out[name] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  if (headers.authorization !== undefined) out.authorization = "(present, not recorded)";
  return out;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function joinUpstream(base, rest) {
  const u = new URL(base);
  const basePath = u.pathname.replace(/\/$/, "");
  const [restPath, restQuery] = rest.split(/\?(.*)/s, 2);
  u.pathname = `${basePath}${restPath === "/" && basePath ? "" : restPath}` || "/";
  u.search = restQuery ? `?${restQuery}` : "";
  return u;
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Bodies kept for re-checking earlier requests when the watch list grows.
const RESCAN_BUDGET_BYTES = 512 * 1024 * 1024;

export function rotatedLogPath(path, n) {
  return path.replace(/(\.r\d+)?\.json$/, "") + `.r${n}.json`;
}

export async function startObserverProxy(options) {
  const opts = {
    host: "127.0.0.1",
    port: 8790,
    run: "unlabeled",
    source: "live",
    // An absent CLI flag arrives as undefined and must not override a default.
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
  };
  // Port 0 asks for an ephemeral port, so its neighbour is meaningless.
  const aggregatorPort = opts.aggregatorPort ?? (opts.port === 0 ? 0 : opts.port + 1);
  const upstreams = {
    raven: opts.raven ? opts.raven.replace(/\/$/, "") : undefined,
    aggregator: opts.aggregator ? opts.aggregator.replace(/\/$/, "") : undefined,
  };
  let commitments = [];
  let needles = [];
  // First place each watched commitment came from, shown beside it on the page.
  let origins = {};
  let run = opts.run;
  const events = [];
  const bodies = new Map();
  let bodyBytes = 0;
  const clients = new Set();
  const startedAt = new Date().toISOString();
  let nextId = 1;
  let writeTimer;
  let snapshotTimer;
  let logPath = opts.logPath;
  let rotation = 0;
  const allowedOrigins = new Set(opts.allowOrigins ?? []);
  const originAllowed = (o) => LOOPBACK_ORIGIN.test(o) || allowedOrigins.has(o);

  function setCommitments(list, origin, { replace = true } = {}) {
    const next = replace ? {} : { ...origins };
    for (const raw of list) {
      const hex = normalizeCommitment(raw);
      if (hex && !(hex in next)) next[hex] = origins[hex] ?? origin;
    }
    const changed =
      Object.keys(next).length !== commitments.length || commitments.some((c) => !(c in next));
    origins = next;
    commitments = Object.keys(next);
    needles = commitments.map(needleFor);
    if (changed) rescan();
    return changed;
  }

  // Order of runs must not decide what gets checked: a note learned later is searched for in
  // every request already recorded.
  function rescan() {
    let touched = false;
    for (const event of events) {
      const body = bodies.get(event.id);
      if (!body) continue;
      const matches = scanForCommitments(needles, body, { url: event.route, request: true });
      if (JSON.stringify(matches) !== JSON.stringify(event.requestMatches) || event.watchedAtScan !== needles.length) {
        event.requestMatches = matches;
        event.watchedAtScan = needles.length;
        touched = true;
      }
    }
    if (touched) {
      scheduleSnapshot();
      scheduleLog();
    }
  }

  function keepBody(id, buf) {
    bodies.set(id, buf);
    bodyBytes += buf.length;
    for (const [oldId, old] of bodies) {
      if (bodyBytes <= RESCAN_BUDGET_BYTES) break;
      bodies.delete(oldId);
      bodyBytes -= old.length;
      const ev = events.find((e) => e.id === oldId);
      if (ev) ev.rescanDropped = true;
    }
  }

  function meta() {
    return {
      source: opts.source,
      startedAt,
      upstreams,
      commitments,
      commitmentOrigins: origins,
      run,
      learn: Boolean(opts.learn),
      note: opts.note,
      logFile: logPath ? logPath.split(/[\\/]/).pop() : undefined,
    };
  }

  function logDocument() {
    return { format: LOG_FORMAT, version: LOG_VERSION, meta: meta(), events };
  }

  function flushLog() {
    if (!logPath) return;
    mkdirSync(dirname(logPath), { recursive: true });
    const tmp = `${logPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(logDocument(), null, 1));
    renameSync(tmp, logPath);
  }

  function scheduleLog() {
    if (!logPath || writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = undefined;
      flushLog();
    }, 200);
  }

  function broadcast(type, payload) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  function scheduleSnapshot() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined;
      broadcast("snapshot", logDocument());
    }, 50);
  }

  // Clearing the page starts a new file, so a recorded session is never lost to a click.
  function rotateLog() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = undefined;
    }
    flushLog();
    const previous = logPath;
    events.length = 0;
    bodies.clear();
    bodyBytes = 0;
    if (opts.logPath) {
      rotation += 1;
      logPath = rotatedLogPath(opts.logPath, rotation);
    }
    if (!opts.quiet && previous) {
      process.stdout.write(`log kept at ${previous}; new log ${logPath}\n`);
    }
  }

  setCommitments(opts.commitments ?? [], opts.commitmentsOrigin ?? "list");

  function record(event) {
    // The watch list may have grown while this request was in flight.
    const body = bodies.get(event.id);
    if (body && event.watchedAtScan !== needles.length) {
      event.requestMatches = scanForCommitments(needles, body, { url: event.route, request: true });
      event.watchedAtScan = needles.length;
    }
    events.push(event);
    broadcast("record", event);
    scheduleLog();
    if (!opts.quiet) {
      const flag = event.requestMatches.length > 0 ? "  COMMITMENT IN REQUEST" : "";
      process.stdout.write(
        `[${event.run}] ${event.upstream.padEnd(10)} ${event.method} ${event.rpcMethod ?? event.route}` +
          ` ${event.status ?? "ERR"} up=${event.requestBytes}B down=${event.responseBytes}B${flag}\n`,
      );
    }
  }

  // The log holds watched commitments and body previews: only the page's own origin (a
  // loopback dev or preview server, or one named with --allow-origin) may read it or reset it.
  function gate(req, res) {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOOPBACK_HOSTS.has(host) && host !== opts.host) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("host not allowed");
      return false;
    }
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    if (!originAllowed(origin)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("origin not allowed");
      return false;
    }
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    return true;
  }

  async function handleControl(req, res, path) {
    if (!gate(req, res)) return;
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === "/observer/events" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(logDocument())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (path === "/observer/log" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(logDocument(), null, 1));
      return;
    }
    if (req.method === "POST") {
      let body = {};
      try {
        const raw = await readBody(req);
        body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("body must be JSON");
        return;
      }
      if (path === "/observer/run" && typeof body.run === "string" && body.run.length <= 32) {
        run = body.run;
      } else if (path === "/observer/commitments" && Array.isArray(body.commitments)) {
        setCommitments(body.commitments, "page");
      } else if (path === "/observer/reset") {
        rotateLog();
      } else {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("unknown control request");
        return;
      }
      broadcast("snapshot", logDocument());
      scheduleLog();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(meta()));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  async function handleProxy(req, res, upstreamName, rest) {
    const base = upstreams[upstreamName];
    if (!base) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`no ${upstreamName} upstream configured`);
      return;
    }
    const started = Date.now();
    const reqBody = await readBody(req);
    const target = joinUpstream(base, rest);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k) && k !== "host" && k !== "content-length") headers[k] = v;
    }
    headers.host = target.host;
    if (reqBody.length > 0 || req.method === "POST" || req.method === "PUT") {
      headers["content-length"] = String(reqBody.length);
    }
    const rpcMethod = jsonRpcMethod(reqBody);
    if (opts.learn && upstreamName === "aggregator") {
      const named = commitmentsNamedBy(reqBody);
      if (named.list.length > 0) {
        const origin = named.origin === "read" ? `${run}-run read` : named.origin;
        if (setCommitments(named.list, origin, { replace: false })) scheduleSnapshot();
      }
    }
    const route = describeRoute(upstreamName, rest, rpcMethod);
    const event = {
      id: nextId++,
      run,
      t: new Date(started).toISOString(),
      tMs: started,
      upstream: upstreamName,
      destination: target.host,
      method: req.method,
      route: rest,
      routeTemplate: route.template,
      block: route.block,
      rpcMethod,
      requestBytes: reqBody.length,
      requestContentType: req.headers["content-type"],
      requestHeaders: pickHeaders(req.headers, RECORDED_REQUEST_HEADERS),
      requestPreview: preview(reqBody, req.headers["content-type"]),
      requestMatches: scanForCommitments(needles, reqBody, { url: rest, request: true }),
      watchedAtScan: needles.length,
    };
    if (route.template === "/v1/instance/{id}/batch") {
      const batch = decodeBatchEnvelope(reqBody);
      if (batch) {
        event.batchQueries = batch.queries;
        if (batch.shardIds) event.shardIds = batch.shardIds;
      }
    }
    keepBody(event.id, reqBody);

    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstreamReq = send(
      target,
      { method: req.method, headers },
      (upstreamRes) => {
        const outHeaders = {};
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (!HOP_BY_HOP.has(k)) outHeaders[k] = v;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        const chunks = [];
        upstreamRes.on("data", (c) => {
          chunks.push(c);
          res.write(c);
        });
        upstreamRes.on("end", () => {
          res.end();
          const wire = Buffer.concat(chunks);
          const decoded = decodeForScan(wire, upstreamRes.headers["content-encoding"]);
          record({
            ...event,
            status: upstreamRes.statusCode,
            durationMs: Date.now() - started,
            responseBytes: wire.length,
            responseDecodedBytes: decoded.length,
            responseContentType: upstreamRes.headers["content-type"],
            responseHeaders: pickHeaders(upstreamRes.headers, RECORDED_RESPONSE_HEADERS),
            responsePreview: preview(decoded, upstreamRes.headers["content-type"]),
            responseMatches: scanForCommitments(needles, decoded, { request: false }),
          });
        });
        upstreamRes.on("error", (err) => {
          res.destroy(err);
        });
      },
    );
    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`upstream error: ${err.message}`);
      } else {
        res.destroy(err);
      }
      record({
        ...event,
        status: undefined,
        durationMs: Date.now() - started,
        responseBytes: 0,
        responseMatches: [],
        error: err.message,
      });
    });
    upstreamReq.end(reqBody);
  }

  const listenUrls = {};

  // `leg` is the one upstream this listener forwards; the main listener also serves the page.
  function serve(leg) {
    return createServer((req, res) => {
      const url = req.url ?? "/";
      const path = url.split("?")[0];
      const handle = async () => {
        if (leg === "raven" && path.startsWith("/observer/")) return handleControl(req, res, path);
        const m = url.match(/^\/(raven|aggregator)(\/.*|\?.*)?$/s);
        if (m && m[1] === leg) {
          const rest = m[2] ? (m[2].startsWith("?") ? `/${m[2]}` : m[2]) : "/";
          return handleProxy(req, res, m[1], rest);
        }
        if (m) {
          res.writeHead(421, { "content-type": "text/plain" });
          res.end(`the ${m[1]} leg listens on ${listenUrls[m[1]]}/${m[1]}`);
          return;
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(
          leg === "raven"
            ? "routes: /raven/*, /observer/events, /observer/log"
            : "routes: /aggregator",
        );
      };
      handle().catch((err) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(err));
      });
    });
  }

  async function listen(server, port) {
    await new Promise((ok, fail) => {
      server.once("error", fail);
      server.listen(port, opts.host, ok);
    });
    return `http://${opts.host}:${server.address().port}`;
  }

  const server = serve("raven");
  const aggregatorServer = serve("aggregator");
  const url = await listen(server, opts.port);
  listenUrls.raven = url;
  let aggregatorUrl;
  try {
    aggregatorUrl = await listen(aggregatorServer, aggregatorPort);
  } catch (err) {
    await new Promise((ok) => server.close(ok));
    throw err;
  }
  listenUrls.aggregator = aggregatorUrl;

  return {
    url,
    aggregatorUrl,
    events,
    setRun(label) {
      run = label;
      broadcast("snapshot", logDocument());
    },
    setCommitments(list, origin = "list") {
      setCommitments(list, origin);
      broadcast("snapshot", logDocument());
    },
    logDocument,
    flushLog,
    get logPath() {
      return logPath;
    },
    async close() {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = undefined;
      }
      if (snapshotTimer) {
        clearTimeout(snapshotTimer);
        snapshotTimer = undefined;
      }
      flushLog();
      for (const res of clients) res.end();
      clients.clear();
      await Promise.all([
        new Promise((ok) => server.close(ok)),
        new Promise((ok) => aggregatorServer.close(ok)),
      ]);
    },
  };
}

function parseArgs(argv) {
  const out = { commitments: [], allowOrigins: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${key} needs a value`);
      i += 1;
      return v;
    };
    switch (key) {
      case "--":
        break;
      case "--port":
        out.port = Number(next());
        break;
      case "--aggregator-port":
        out.aggregatorPort = Number(next());
        break;
      case "--host":
        out.host = next();
        break;
      case "--raven":
        out.raven = next();
        break;
      case "--aggregator":
        out.aggregator = next();
        break;
      case "--commitment":
        out.commitments.push(next());
        break;
      case "--commitments-file":
        (out.commitmentsFiles ??= []).push(next());
        break;
      case "--log":
        out.logPath = resolve(next());
        break;
      case "--run":
        out.run = next();
        break;
      case "--learn":
        out.learn = true;
        break;
      case "--allow-origin":
        out.allowOrigins.push(next().replace(/\/$/, ""));
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument ${key}`);
    }
  }
  return out;
}

/** A JSON array, a whitespace list, or an observer log (its watch list): a rehearsal's log
 *  carries every note that rehearsal's reads named. */
export function readCommitmentsFile(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (raw.startsWith("[")) return JSON.parse(raw);
  if (raw.startsWith("{")) {
    const doc = JSON.parse(raw);
    if (doc.format !== LOG_FORMAT || !Array.isArray(doc.meta?.commitments)) {
      throw new Error(`${path}: a JSON object must be an observer log`);
    }
    return doc.meta.commitments;
  }
  return raw.split(/[\s,]+/).filter(Boolean);
}

const USAGE = `observer proxy

  --raven <url>             Raven node base URL (wallet endpoint becomes
                            http://127.0.0.1:<port>/raven)
  --aggregator <url>        PPOI aggregator JSON-RPC URL (wallet POI URL and aggregator become
                            http://127.0.0.1:<aggregator-port>/aggregator)
  --commitment <hex>        a note commitment to watch for (repeatable)
  --commitments-file <path> JSON array, whitespace-separated list, or an earlier observer log
                            (its watch list); repeatable
  --log <path>              JSON log path (default observer-logs/session-<time>.json); Clear on
                            the page keeps it and continues in <path>.rN.json
  --run <label>             initial run label: stock or raven (the page can change it)
  --learn                   also watch every commitment the wallet names to the aggregator in
                            the clear (status and path reads, proof-submission outputs); earlier
                            requests are re-checked each time the list grows
  --allow-origin <origin>   a page origin besides loopback allowed to read the log (repeatable)
  --port <n>                listen port for Raven and the page (default 8790)
  --aggregator-port <n>     listen port for the aggregator (default port + 1). A separate
                            origin: the SDK refuses a pin source on the Raven endpoint's origin
  --host <addr>             listen address (default 127.0.0.1)

Env fallbacks: OBSERVER_RAVEN_UPSTREAM, OBSERVER_AGGREGATOR_UPSTREAM, OBSERVER_PORT,
OBSERVER_AGGREGATOR_PORT, OBSERVER_COMMITMENTS (comma-separated).`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const commitments = [
    ...args.commitments,
    ...(args.commitmentsFiles ?? []).flatMap(readCommitmentsFile),
    ...(process.env.OBSERVER_COMMITMENTS ?? "").split(",").filter(Boolean),
  ];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const proxy = await startObserverProxy({
    host: args.host,
    port: args.port ?? Number(process.env.OBSERVER_PORT ?? 8790),
    aggregatorPort:
      args.aggregatorPort ??
      (process.env.OBSERVER_AGGREGATOR_PORT ? Number(process.env.OBSERVER_AGGREGATOR_PORT) : undefined),
    raven: args.raven ?? process.env.OBSERVER_RAVEN_UPSTREAM,
    aggregator: args.aggregator ?? process.env.OBSERVER_AGGREGATOR_UPSTREAM,
    commitments,
    logPath: args.logPath ?? resolve("observer-logs", `session-${stamp}.json`),
    run: args.run,
    learn: args.learn,
    allowOrigins: args.allowOrigins,
  });
  const doc = proxy.logDocument();
  process.stdout.write(
    `observer proxy on ${proxy.url}\n` +
      `  raven      ${proxy.url}/raven  ->  ${doc.meta.upstreams.raven ?? "(not set)"}\n` +
      `  aggregator ${proxy.aggregatorUrl}/aggregator  ->  ${doc.meta.upstreams.aggregator ?? "(not set)"}\n` +
      `  events     ${proxy.url}/observer/events\n` +
      `  watching   ${doc.meta.commitments.length} commitment(s); run label "${doc.meta.run}"\n` +
      `  log        ${proxy.logPath}\n`,
  );
  const stop = async () => {
    await proxy.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`);
    process.exit(1);
  });
}
