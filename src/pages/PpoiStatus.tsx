import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Search } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { fetchShieldsByEoa, type ShieldEvent } from "@/lib/subsquid-client";
import { CONFIG } from "@/lib/config";
import { CHAIN, PIR_BENCH, PIR_TABLES } from "@/lib/numbers";
import { formatBytes, formatLatency, formatNumber, shortHex } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { Tooltip } from "@/components/ui/Tooltip";
import { AccordionRoot, AccordionItem } from "@/components/ui/Accordion";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { StageTimeline, type TimelineNode } from "@/components/StageTimeline";
import { BootIndicator } from "@/components/BootIndicator";

const SAMPLE_ADDRESS = "0x48c2cc7e4a45202753befa8911cf2253a5d165b3";
const PPOI_INSTANCE = "ppoi-status-ofac";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading"; address: string }
  | {
      kind: "ok";
      address: string;
      matched: ShieldEvent[];
      scannedShields: number;
      scannedFrom: number;
      scannedTo: number;
    }
  | { kind: "error"; address: string; message: string };

type PirState =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "ok";
      recoveredHex: string;
      postMs: number;
      totalMs: number;
      queryBytes: number;
      responseBytes: number;
      targetRow: number;
      isMatchedQuery: boolean;
    }
  | { kind: "error"; message: string };

export function PpoiStatus() {
  const boot = useBoot();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const [pir, setPir] = useState<PirState>({ kind: "idle" });

  useEffect(() => {
    boot.ensureBooted(PPOI_INSTANCE).catch(() => undefined);
  }, [boot]);

  const debouncedLookup = useDebouncedCallback((addr: string) => {
    runLookup(addr);
  }, 1_500);
  const debouncedPir = useDebouncedCallback(() => {
    runPir();
  }, 1_500);

  async function runLookup(addr: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setLookup({ kind: "error", address: addr, message: "not a valid 0x... EOA (need exactly 20 bytes hex)" });
      return;
    }
    setLookup({ kind: "loading", address: addr });
    setPir({ kind: "idle" });
    const r = await fetchShieldsByEoa(CONFIG.ethRpcUrl, addr, 200);
    if (!r.ok) {
      setLookup({ kind: "error", address: addr, message: r.error });
      return;
    }
    setLookup({
      kind: "ok",
      address: addr,
      matched: r.matched,
      scannedShields: r.scannedShields,
      scannedFrom: r.scannedBlockRange.from,
      scannedTo: r.scannedBlockRange.to,
    });
  }

  async function runPir() {
    if (pir.kind === "running") return;
    const snapshot = lookup;
    setPir({ kind: "running" });
    try {
      const t0 = performance.now();
      const isMatchedQuery = snapshot.kind === "ok" && snapshot.matched.length > 0;
      const idx = isMatchedQuery && snapshot.kind === "ok"
        ? Number(BigInt(snapshot.matched[0].hash) & BigInt(CHAIN.treeMaxItems - 1))
        : 0;
      const result = await boot.query(PPOI_INSTANCE, idx);
      const totalMs = performance.now() - t0;
      setPir({
        kind: "ok",
        recoveredHex: result.recoveredHex,
        postMs: result.postMs,
        totalMs,
        queryBytes: result.queryBytes,
        responseBytes: result.responseBytes,
        targetRow: idx,
        isMatchedQuery,
      });
    } catch (err) {
      setPir({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const pirPhase: StagePhase = pir.kind === "running" ? "running" : pir.kind === "ok" ? "done" : pir.kind === "error" ? "error" : "idle";

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-2">
            balance-refresh leak
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl mb-3">PPOI status, privately</h1>
          <p className="text-fg-secondary text-[0.95rem] leading-relaxed">
            Every balance refresh, the stock Railgun wallet POSTs the full list of blinded
            commitments it owns to the PPOI server. The server clusters those commitments by
            source IP and learns the wallet&apos;s UTXO set. For shield-derived commitments,
            the server can also tie the cluster back to the on-chain depositor address. Raven
            substitutes the per-IP POST with private retrieval against the same status
            table held by{" "}
            <Tooltip
              content={
                <div className="space-y-1">
                  <div>cell shape: 65,536 entries x 32 B = 2.0 MiB</div>
                  <div>row layout: blinded commitment hex; status enum carried out-of-band</div>
                  <div>per-query: ~71.9 ms total / 69.3 ms server (3-seed median)</div>
                </div>
              }
            >
              <code className="font-mono text-[0.85rem] underline decoration-dotted underline-offset-2 cursor-help">
                {PPOI_INSTANCE}
              </code>
            </Tooltip>
            .
          </p>
        </div>

        <PpoiStatusTimeline lookup={lookup} pirPhase={pirPhase} />

        <BootIndicator className="mt-6" primaryInstance="ppoi-status-ofac" />

        <div className="mt-8 border border-fg-faint bg-bg-secondary p-5">
          <div className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-3">
            see your own address leak
          </div>
          <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
            <div className="flex-1 flex items-center border border-fg-faint focus-within:border-accent">
              <Search size={14} className="text-fg-muted ml-3" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.trim())}
                placeholder="0x..."
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input) debouncedLookup(input);
                }}
                className="flex-1 bg-transparent px-3 py-2.5 text-mono-xs text-fg placeholder:text-fg-muted outline-none"
              />
            </div>
            <button
              onClick={() => debouncedLookup(input || SAMPLE_ADDRESS)}
              disabled={lookup.kind === "loading"}
              className="inline-flex items-center gap-2 border border-fg text-fg px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.06em] hover:bg-fg hover:text-bg transition-colors disabled:opacity-50"
            >
              {lookup.kind === "loading" ? "Scanning recent shields..." : input ? "Show leak" : "Use sample address"}
              <ArrowRight size={12} />
            </button>
          </div>
          <p className="text-[0.6rem] text-fg-muted mt-2 font-mono break-all">
            {CONFIG.subsquidUrl.replace(/^https?:\/\//, "")} ·
            shieldCommitments(orderBy: blockNumber_DESC, limit: 200) -&gt;
            eth_getTransactionByHash · filter(tx.from == addr)
          </p>
        </div>

        {lookup.kind === "error" && (
          <div className="mt-6 border border-error/40 bg-error/5 p-4 text-[0.85rem] text-fg-secondary max-w-3xl">
            <strong className="text-error">lookup failed</strong> · {lookup.message}
          </div>
        )}

        {lookup.kind === "ok" && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-px bg-fg-faint">
            <div className="bg-public-dim border-l-2 border-public p-5">
              <div className="text-[0.55rem] uppercase tracking-[0.18em] text-public font-mono mb-2">
                what the PPOI operator sees today
              </div>
              <h3 className="font-serif text-xl mb-3">Cluster: {shortHex(lookup.address, 6, 4)}</h3>
              {lookup.matched.length === 0 ? (
                <p className="text-fg-secondary text-[0.85rem] leading-relaxed">
                  No matches in the last {formatNumber(lookup.scannedShields)} shields
                  (blocks {formatNumber(lookup.scannedFrom)}-{formatNumber(lookup.scannedTo)}).
                  Either this address has not shielded recently, or its shields are older than
                  the scan window. Try the sample button.
                </p>
              ) : (
                <>
                  <p className="text-fg-secondary text-[0.85rem] leading-relaxed mb-4">
                    {formatNumber(lookup.matched.length)} Shield
                    {lookup.matched.length === 1 ? "" : "s"} this address originated within the
                    last {formatNumber(lookup.scannedShields)} on-chain shields (blocks
                    {" "}{formatNumber(lookup.scannedFrom)}-{formatNumber(lookup.scannedTo)}).
                    Every balance refresh, the wallet POSTs all of these to the PPOI operator.
                  </p>
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {lookup.matched.map((r) => (
                      <div key={r.id} className="text-mono-xs text-fg-secondary border border-fg-faint/30 px-3 py-1.5 break-all">
                        <span className="text-public mr-2">leak</span>
                        tree={r.treeNumber} pos={r.treePosition} block={formatNumber(r.blockNumber)}
                        <div className="text-fg-muted text-[0.6rem] mt-0.5">
                          tx{" "}
                          <a
                            href={`https://etherscan.io/tx/${r.transactionHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-fg-secondary underline-offset-2 hover:underline"
                          >
                            {shortHex(r.transactionHash, 8, 6)}
                          </a>{" "}
                          · bc {shortHex(r.hash, 6, 4)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="bg-private-dim border-r-2 border-private p-5 flex flex-col">
              <div className="text-[0.55rem] uppercase tracking-[0.18em] text-private font-mono mb-2">
                what raven turns it into
              </div>
              <h3 className="font-serif text-xl mb-3">One encrypted query</h3>
              <p className="text-fg-secondary text-[0.85rem] leading-relaxed">
                The wallet looks up its UTXO row index locally (Raven publishes a public
                per-list blinded-commitment-to-index map; cheap, public-by-design), then
                PIR-queries that row. The server does not learn the row index even though it
                holds the bearer.
              </p>
              <button
                type="button"
                onClick={debouncedPir}
                disabled={pir.kind === "running" || !boot.isReady(PPOI_INSTANCE)}
                className="mt-4 inline-flex items-center gap-2 border border-private text-private px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.06em] hover:bg-private hover:text-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-start"
                title={!boot.isReady(PPOI_INSTANCE) ? "Privacy keys still loading" : undefined}
              >
                {!boot.isReady(PPOI_INSTANCE)
                  ? "Preparing privacy keys..."
                  : pir.kind === "running"
                  ? "Running PIR..."
                  : lookup.kind === "ok" && lookup.matched.length > 0
                  ? `Fire query for matched BC #1 → row ${Number(BigInt(lookup.matched[0].hash) & BigInt(CHAIN.treeMaxItems - 1))}`
                  : "Fire wire-shape demo against row 0"}
                <ArrowRight size={12} />
              </button>
              {lookup.kind === "ok" && lookup.matched.length === 0 && (
                <p className="mt-2 text-[0.65rem] text-warning leading-snug">
                  No matched shields for this address, so the query is fired against{" "}
                  <strong>row 0</strong> as a wire-shape demo. The 32 B you get back is the
                  operator&apos;s blinded commitment at row 0, NOT a claim about this
                  address. Use the sample button (real shielder) to query a row tied to
                  your address.
                </p>
              )}
              {pir.kind === "ok" && (
                <>
                  <div className="mt-3 text-[0.6rem] uppercase tracking-[0.14em] font-mono">
                    {pir.isMatchedQuery ? (
                      <span className="text-success">queried row {pir.targetRow} · low-16-bits of matched BC hash</span>
                    ) : (
                      <span className="text-warning">queried row {pir.targetRow} · wire-shape demo (address not matched)</span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-mono-xs">
                    <div>
                      <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted">post</div>
                      <div className="text-fg">{formatLatency(pir.postMs)}</div>
                    </div>
                    <div>
                      <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted">total wall</div>
                      <div className="text-fg">{formatLatency(pir.totalMs)}</div>
                    </div>
                    <div>
                      <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted">up</div>
                      <div className="text-fg">{formatBytes(pir.queryBytes)}</div>
                    </div>
                    <div>
                      <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted">down</div>
                      <div className="text-fg">{formatBytes(pir.responseBytes)}</div>
                    </div>
                  </div>
                </>
              )}
              {pir.kind === "error" && (
                <div className="mt-3 text-mono-xs text-error">{pir.message}</div>
              )}
            </div>
          </div>
        )}

        {(lookup.kind === "ok" || pir.kind === "ok") && (
          <PerStageCard
            index={1}
            title="Per private query (PPOI status)"
            oneLiner={`One encrypted query against ${PPOI_INSTANCE}.`}
            phase={pirPhase}
            client={{
              label: "Client (query gen)",
              body: (
                <>
                  <p>
                    Wallet computes row index from its UTXO via the public
                    blinded-commitment-to-index map, encrypts under the cached PIR session.
                  </p>
                  <ul className="mt-2 text-mono-xs text-fg-secondary space-y-0.5">
                    <li>~{PIR_BENCH.clientGenMs.toFixed(2)} ms client gen (3-seed median)</li>
                    <li>up: {formatBytes(PIR_BENCH.upBytes)} encrypted</li>
                  </ul>
                </>
              ),
            }}
            server={{
              label: "Server (respond)",
              body: (
                <>
                  <p>
                    Server runs an NTT-domain matrix-vector multiply over the encrypted index
                    against the {formatBytes(PIR_TABLES.ppoiStatusBytes)} blinded-commitment
                    table (one 32 B blinded commitment per row, ordered by the public
                    per-list mapping). The operator never sees which row was requested.
                  </p>
                </>
              ),
            }}
            extract={
              pir.kind === "ok"
                ? {
                    label: "Recovered blinded commitment (row contents)",
                    defaultOpen: true,
                    body: (
                      <div className="space-y-2">
                        <p>
                          The 32 B at this row IS the blinded commitment the operator has
                          indexed at the wallet&apos;s row index. The wallet compares this to
                          its own BC to confirm the operator listed it. The status enum
                          (Valid / ShieldBlocked / Pending / ProofSubmitted) is{" "}
                          <strong>not</strong> in the PIR row - it lives in a public
                          per-list <code className="font-mono text-[0.78rem]">ListStatusHeader</code>
                          {" "}the wallet bulk-downloads once per epoch and consults locally.
                          That keeps the PIR records uniform 32 B (no padding) and the cell
                          shape matches the locked benchmark exactly.
                        </p>
                        <HexBlock hex={`0x${pir.recoveredHex}`} label="blinded commitment at row" defaultOpen />
                      </div>
                    ),
                  }
                : undefined
            }
          />
        )}

        <div className="mt-12">
          <h2 className="font-serif text-2xl mb-4">Frequently asked, with citations</h2>
          <AccordionRoot type="single" collapsible defaultValue="onchain">
            <AccordionItem
              value="onchain"
              defaultOpen
              trigger="Doesn't the PPOI server already see every blinded commitment from chain?"
            >
              <p>
                For Shield events, yes. The Shield event in Railgun&apos;s contracts carries a
                {" "}<code className="font-mono text-[0.78rem]">CommitmentPreimage</code> struct
                with the note public key (npk) in plaintext on chain
                {" "}<Cite href="https://github.com/Railgun-Privacy/contract/blob/9ec09123eb140fdaaf3a5ff1f29d634c353630cd/contracts/logic/RailgunLogic.sol#L67-L73">RailgunLogic.sol L67-73</Cite>,
                {" "}<Cite href="https://github.com/Railgun-Privacy/contract/blob/9ec09123eb140fdaaf3a5ff1f29d634c353630cd/contracts/logic/Globals.sol#L71-L75">Globals.sol L71-75</Cite>.
                Anyone can compute the blinded commitment from chain data alone via
                {" "}<code className="font-mono text-[0.78rem]">Poseidon(commitmentHash, npk, globalTreePosition)</code>
                {" "}<Cite href="https://github.com/Railgun-Community/engine/blob/2550cd653d706a3897a9d905fe906f58a4e87a22/src/poi/blinded-commitment.ts#L13-L16">blinded-commitment.ts L13-16</Cite>.
              </p>
              <p className="mt-3">
                For Unshield, the blinded commitment is the
                {" "}<code className="font-mono text-[0.78rem]">railgunTxid</code>, derivable from
                on-chain calldata.
              </p>
              <p className="mt-3">
                For <strong className="text-fg">Transact</strong>, the answer is different. The
                {" "}<code className="font-mono text-[0.78rem]">npk</code> is sealed inside an
                AES-256-GCM ciphertext encrypted to the recipient
                {" "}<Cite href="https://github.com/Railgun-Community/engine/blob/2550cd653d706a3897a9d905fe906f58a4e87a22/src/note/transact-note.ts#L264-L272">transact-note.ts L264-272</Cite>,
                {" "}<Cite href="https://github.com/Railgun-Privacy/contract/blob/9ec09123eb140fdaaf3a5ff1f29d634c353630cd/contracts/logic/Globals.sol#L31-L37">Globals.sol L31-37 (CommitmentCiphertext)</Cite>.
                The chain alone tells the PPOI server nothing.
              </p>
              <p className="mt-3">
                But your wallet then POSTs the transact blinded commitments to the server via
                {" "}<code className="font-mono text-[0.78rem]">getPOIsPerList</code>
                {" "}<Cite href="https://github.com/Railgun-Community/private-proof-of-innocence/blob/4b1eaf6ef19099dbfd6b43b1ca78d2ce0132a752/packages/node/src/api/schemas.ts#L252-L263">schemas.ts L252-263</Cite>
                {" "}and{" "}<code className="font-mono text-[0.78rem]">submitTransactProof</code>
                {" "}<Cite href="https://github.com/Railgun-Community/private-proof-of-innocence/blob/4b1eaf6ef19099dbfd6b43b1ca78d2ce0132a752/packages/node/src/api/schemas.ts#L101-L120">schemas.ts L101-120</Cite>.
                That POST is what PIR substitution closes.
              </p>
            </AccordionItem>
            <AccordionItem
              value="leak-mechanics"
              trigger="What does the operator actually learn from the POST today?"
            >
              <p>
                Per request, the operator learns: the client TLS-terminating IP, the chain plus
                txidVersion, the exact{" "}
                <code className="font-mono text-[0.78rem]">blindedCommitment[]</code> of every
                UTXO the wallet currently cares about, and the type per element (Shield /
                Transact / Unshield).
              </p>
              <p className="mt-2">
                Across requests, one IP queries{" "}
                <code className="font-mono text-[0.78rem]">[bc1, bc2, ..., bcK]</code> in one
                batch. The server clusters &quot;these K opaque IDs belong to the same wallet at
                IP X.&quot; The cluster grows monotonically as the wallet acquires UTXOs.
                Combined with the on-chain shield-derived BC-to-EOA mapping, the cluster bridges
                to a real Ethereum address.
              </p>
            </AccordionItem>
            <AccordionItem
              value="bc-to-idx"
              trigger="How does the wallet know which row index to PIR-query?"
            >
              <p>
                Raven publishes a public per-list bulk blinded-commitment-to-index map. The
                wallet downloads it once per instance epoch (small, public-by-design, not
                per-wallet-private), looks up its own UTXO&apos;s row index locally, then
                PIR-queries that row. The operator sees the encrypted query, not the row.
              </p>
            </AccordionItem>
          </AccordionRoot>
        </div>
      </div>
    </section>
  );
}

function PpoiStatusTimeline({ lookup, pirPhase }: { lookup: LookupState; pirPhase: StagePhase }) {
  const lookupDone = lookup.kind === "ok" || lookup.kind === "error";
  const nodes: TimelineNode[] = [
    {
      id: "addr",
      label: "Paste address",
      phase: lookup.kind === "idle" ? "idle" : "done",
    },
    {
      id: "leak",
      label: "Public-side leak",
      phase:
        lookup.kind === "loading"
          ? "running"
          : lookup.kind === "ok"
          ? "done"
          : lookup.kind === "error"
          ? "error"
          : "idle",
    },
    {
      id: "pir",
      label: "Private retrieval",
      phase: pirPhase,
    },
    {
      id: "result",
      label: "Recovered BC at row",
      phase: pirPhase === "done" ? "done" : "idle",
    },
  ];
  const activeIndex =
    lookup.kind === "idle"
      ? 0
      : lookup.kind === "loading"
      ? 1
      : !lookupDone
      ? 0
      : pirPhase === "running"
      ? 2
      : pirPhase === "done"
      ? 3
      : 1;
  return (
    <div className="mt-6">
      <StageTimeline nodes={nodes} activeIndex={activeIndex} onSelect={() => undefined} />
    </div>
  );
}

function Cite({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline inline-flex items-center gap-0.5"
    >
      <code className="font-mono text-[0.74rem]">{children}</code>
      <ExternalLink size={9} />
    </a>
  );
}
