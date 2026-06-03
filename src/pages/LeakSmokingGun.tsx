import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { CONFIG } from "@/lib/config";
import { decodeHttpResponse } from "@/lib/http-response";
import { getNoxClient } from "@/lib/nox";
import { useNoxClient } from "@/hooks/useNoxClient";
import { useClientIp } from "@/hooks/useClientIp";
import { useNoxNodes } from "@/hooks/useNoxNodes";
import {
  CITATIONS_VERIFIED_AT,
  EXAMPLE_EMPTY_RECIPIENT,
  EXAMPLE_UNSHIELD_RECIPIENT,
  L2_CITATIONS,
  UNSHIELD_QUERY,
  permalink,
} from "@/lib/leak-data";
import { BeforeAfterPane } from "@/components/leaks/BeforeAfterPane";
import { IpDetails } from "@/components/leaks/IpDetails";
import { CitationFooter } from "@/components/leaks/CitationFooter";
import { NoxRouteVisualizer } from "@/components/leaks/NoxRouteVisualizer";
import { OperatorPerspective } from "@/components/leaks/OperatorPerspective";
import { WireFormatBlock, type WireResult } from "@/components/leaks/WireFormatBlock";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const QUERY_NAME = "GetRailgunTransactionsByUnshieldToAddress";
const ENGINE_DOUBLE_SYNC = permalink("engine", "src/railgun-engine.ts", "L603-L637");

interface Pane {
  wire: WireResult;
  rows: number | null;
}

const IDLE_PANE: Pane = { wire: { kind: "idle" }, rows: null };

function requestBodyJson(address: string): string {
  return JSON.stringify({ query: UNSHIELD_QUERY, variables: { address } });
}

function requestBodyDisplay(address: string): string {
  return `${UNSHIELD_QUERY}\n\nvariables ${JSON.stringify({ address })}`;
}

function summarizeGraphql(text: string): { bodyText: string; rows: number | null } {
  try {
    const parsed: { data?: { transactions?: object[] } } = JSON.parse(text);
    const tx = parsed.data?.transactions;
    if (!Array.isArray(tx)) {
      return { bodyText: text.slice(0, 1500), rows: null };
    }
    const head = tx.slice(0, 2);
    const pretty = JSON.stringify({ data: { transactions: head } }, null, 2);
    const tail =
      tx.length > head.length
        ? `\n\n${tx.length - head.length} further row(s) elided. ${tx.length} total.`
        : `\n\n${tx.length} row(s) total.`;
    return { bodyText: pretty + tail, rows: tx.length };
  } catch {
    return { bodyText: text.slice(0, 1500), rows: null };
  }
}

async function fireDirect(url: string, address: string): Promise<Pane> {
  const start = performance.now();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: requestBodyJson(address),
    });
    const text = await resp.text();
    const latencyMs = performance.now() - start;
    const { bodyText, rows } = summarizeGraphql(text);
    const bytes = new TextEncoder().encode(text).length;
    return { wire: { kind: "done", status: resp.status, latencyMs, bytes, bodyText }, rows };
  } catch (err) {
    return { wire: { kind: "error", message: err instanceof Error ? err.message : String(err) }, rows: null };
  }
}

async function fireNox(url: string, address: string): Promise<Pane> {
  const body = new TextEncoder().encode(requestBodyJson(address));
  const start = performance.now();
  try {
    const client = await getNoxClient();
    const raw = await client.httpRequest(
      "POST",
      url,
      [
        ["content-type", "application/json"],
        ["accept", "application/json"],
      ],
      body,
      { expectedResponseBytes: 200_000 },
    );
    const decoded = decodeHttpResponse(raw);
    const latencyMs = performance.now() - start;
    const text = new TextDecoder().decode(decoded.body);
    const { bodyText, rows } = summarizeGraphql(text);
    return { wire: { kind: "done", status: decoded.status, latencyMs, bytes: decoded.body.length, bodyText }, rows };
  } catch (err) {
    return { wire: { kind: "error", message: err instanceof Error ? err.message : String(err) }, rows: null };
  }
}

export function LeakSmokingGun(): ReactElement {
  const nox = useNoxClient();
  const clientIp = useClientIp();
  const noxNodes = useNoxNodes();
  const [address, setAddress] = useState(EXAMPLE_UNSHIELD_RECIPIENT);
  const [before, setBefore] = useState<Pane>(IDLE_PANE);
  const [after, setAfter] = useState<Pane>(IDLE_PANE);
  const [firedAt, setFiredAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const normalized = address.trim().toLowerCase();
  const valid = ADDRESS_PATTERN.test(normalized);
  const operator = useMemo(() => hostOf(CONFIG.subsquidUrl, "rail-squid.squids.live"), []);
  const emptyResult = before.rows === 0 || after.rows === 0;

  const beforeIpValue = clientIp.data?.ip ?? "your public IP";
  const beforeIpInfo =
    clientIp.data && clientIp.data.details.length > 0 ? (
      <IpDetails heading="what the indexer can resolve from your IP" rows={clientIp.data.details} />
    ) : undefined;
  const afterIpValue = noxNodes ? noxNodes.exit : "a NOX exit node";
  const afterIpInfo = noxNodes ? (
    <IpDetails
      heading="shared NOX exit pool"
      rows={noxNodes.exitIps.map((ip, i) => ({ label: `exit ${i + 1}`, value: ip }))}
      note="NOX picks a fresh 3-hop route per packet (entry, mix, exit). rail-squid records one of these exit IPs, shared across every NOX user. Your IP never reaches it."
    />
  ) : undefined;

  async function run(): Promise<void> {
    if (!valid || running) return;
    const addr = normalized;
    const ts = new Date().toISOString();
    setFiredAt(ts);
    setRunning(true);
    setBefore({ wire: { kind: "loading", note: "querying rail-squid" }, rows: null });
    setAfter({ wire: { kind: "loading", note: "connecting to NOX" }, rows: null });
    void nox.connect();
    const [b, a] = await Promise.all([fireDirect(CONFIG.subsquidUrl, addr), fireNox(CONFIG.subsquidUrl, addr)]);
    setBefore(b);
    setAfter(a);
    setRunning(false);
  }

  const afterWire: WireResult =
    after.wire.kind === "loading"
      ? { kind: "loading", note: nox.status === "connecting" ? "connecting to NOX (WASM + live topology)" : "routing through Sphinx 3-hop" }
      : after.wire;

  return (
    <section className="bg-bg">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        <div className="pt-14 sm:pt-20 pb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Transport layer · The smoking gun
          </p>
          <h1 className="mt-4 font-serif text-4xl sm:text-5xl lg:text-[3.75rem] leading-[1.02] tracking-tight max-w-[20ch] font-normal">
            The query that names a withdrawal.
          </h1>
          <p className="mt-6 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[68ch]">
            When a Railgun wallet syncs its sent history it asks the indexer one question:
            which unshields went to address X. The destination EOA rides in the GraphQL filter
            in plaintext, alongside your IP and the timestamp of your sync.
          </p>
          <p className="mt-3 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[68ch]">
            This is the lookup pattern behind the public October 2025 deanonymisation of the
            Bittensor hacker. Paste an EOA below. The left pane fires the wallet&apos;s real query
            against the live indexer. The right pane sends the same query through the NOX mixnet,
            so rail-squid still learns the question but not who asked it.
          </p>
        </div>

        <Section num="01" kicker="Pick a recipient EOA">
          <div className="mt-8 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[20rem]">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                unshield recipient
              </span>
              <input
                type="text"
                value={address}
                spellCheck={false}
                onChange={(e) => setAddress(e.target.value)}
                disabled={running}
                placeholder="0x..."
                className="h-11 bg-bg-secondary border border-fg-faint px-3 font-mono text-[0.85rem] text-fg outline-none focus:border-accent disabled:opacity-50 w-full"
              />
            </div>
            <button
              type="button"
              onClick={run}
              disabled={!valid || running}
              className="h-11 inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {running ? "Firing both panes" : "Fire the query"}
              {running ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ExamplePill label="known recipient (2 unshields)" onClick={() => setAddress(EXAMPLE_UNSHIELD_RECIPIENT)} active={normalized === EXAMPLE_UNSHIELD_RECIPIENT} disabled={running} />
            <ExamplePill label="burn address (empty case)" onClick={() => setAddress(EXAMPLE_EMPTY_RECIPIENT)} active={normalized === EXAMPLE_EMPTY_RECIPIENT} disabled={running} />
          </div>
          {!valid ? (
            <p className="mt-3 text-[0.78rem] text-fg-muted">Enter a 20 byte EOA (0x followed by 40 hex characters).</p>
          ) : null}
        </Section>

        <Section num="02" kicker="Same query, two transports">
          <div className="mt-8">
            <BeforeAfterPane
              before={
                <>
                  <WireFormatBlock
                    method="POST"
                    url={CONFIG.subsquidUrl}
                    headers={[
                      ["content-type", "application/json"],
                      ["accept", "application/json"],
                    ]}
                    body={requestBodyDisplay(normalized)}
                    result={before.wire}
                  />
                  <OperatorPerspective
                    operator={operator}
                    tone="leak"
                    learns={[
                      { label: "ip", value: beforeIpValue, emphasis: true, info: beforeIpInfo },
                      { label: "query", value: QUERY_NAME },
                      { label: "toAddress", value: normalized, emphasis: true },
                      { label: "timestamp", value: firedAt ?? "(set on run)" },
                    ]}
                    note="The indexer ties your real IP to the exact address you are interested in, at the moment you sync."
                  />
                </>
              }
              after={
                <>
                  <NoxRouteVisualizer entry={noxNodes?.entry} mix={noxNodes?.mix} exit={noxNodes?.exit} />
                  <WireFormatBlock
                    method="POST"
                    url={CONFIG.subsquidUrl}
                    headers={[
                      ["content-type", "application/json"],
                      ["accept", "application/json"],
                    ]}
                    body={requestBodyDisplay(normalized)}
                    result={afterWire}
                  />
                  <OperatorPerspective
                    operator={operator}
                    tone="shielded"
                    learns={[
                      { label: "ip", value: afterIpValue, info: afterIpInfo },
                      { label: "query", value: QUERY_NAME },
                      { label: "toAddress", value: normalized, emphasis: true },
                      { label: "timestamp", value: firedAt ?? "(set on run)" },
                    ]}
                    note="The exit node IP is shared across the entire NOX user base. rail-squid still sees the query and the address; it can no longer bind them to your IP or your sync timing."
                  />
                </>
              }
            />
            {emptyResult ? (
              <p className="mt-3 text-[0.78rem] text-fg-muted leading-relaxed">
                No matching unshields found for this address. The leak still fired: the indexer
                recorded that someone asked about this EOA. The demonstration does not depend on a
                non-empty result.
              </p>
            ) : null}
          </div>
        </Section>

        <Section num="03" kicker="The second mouth">
          <p className="mt-8 text-fg-secondary text-[0.95rem] leading-relaxed max-w-[72ch]">
            The indexer query is only half of it. Every scan cycle the engine runs quick-sync
            against this indexer and then slow-sync against a fallback RPC provider, so the same
            wake-up leaks on two channels at once. The NOX adapter wraps both: the indexer POST and
            the RPC eth_getLogs both leave through a shared exit node, not your IP.
          </p>
          <a
            href={ENGINE_DOUBLE_SYNC}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[0.8rem] text-accent hover:text-accent-light font-mono"
          >
            railgun-engine.ts:603-637
            <ArrowRight size={12} />
          </a>
        </Section>

        <div className="pb-24">
          <CitationFooter citations={L2_CITATIONS} verifiedAt={CITATIONS_VERIFIED_AT} />
        </div>
      </div>
    </section>
  );
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).host;
  } catch {
    return fallback;
  }
}

function Section({ num, kicker, children }: { num: string; kicker: string; children: ReactNode }): ReactElement {
  return (
    <div className="border-t border-fg-faint pt-10 pb-16">
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-3xl text-accent leading-none">{num}</span>
        <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
          {kicker}
        </span>
      </div>
      {children}
    </div>
  );
}

function ExamplePill({
  label,
  onClick,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  disabled: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 border text-[0.72rem] font-mono transition-colors disabled:opacity-40 ${
        active ? "border-accent text-fg bg-accent-dim" : "border-fg-faint text-fg-secondary hover:text-fg hover:border-fg-muted"
      }`}
    >
      {label}
    </button>
  );
}
