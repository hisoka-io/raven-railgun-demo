import { useEffect, useState } from "react";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import { useBoot } from "@/lib/boot-context";
import { fetchShieldsByEoa, type ShieldEvent } from "@/lib/subsquid-client";
import { CONFIG } from "@/lib/config";
import { CHAIN, PIR_BENCH, PIR_TABLES } from "@/lib/numbers";
import { formatBytes, formatLatency, formatNumber, shortHex } from "@/lib/format";
import { PerStageCard, type StagePhase } from "@/components/PerStageCard";
import { HexBlock } from "@/components/HexBlock";
import { AccordionRoot, AccordionItem } from "@/components/ui/Accordion";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
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
  const [input, setInput] = useState(SAMPLE_ADDRESS);
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const [pir, setPir] = useState<PirState>({ kind: "idle" });

  useEffect(() => {
    boot.ensureBooted(PPOI_INSTANCE).catch(() => undefined);
  }, [boot]);

  const debouncedRun = useDebouncedCallback((addr: string) => {
    runFlow(addr);
  }, 1_500);

  async function runFlow(addr: string) {
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
    const lookupResult: LookupState = {
      kind: "ok",
      address: addr,
      matched: r.matched,
      scannedShields: r.scannedShields,
      scannedFrom: r.scannedBlockRange.from,
      scannedTo: r.scannedBlockRange.to,
    };
    setLookup(lookupResult);
    await runPir(lookupResult);
  }

  async function runPir(currentLookup: LookupState) {
    if (pir.kind === "running") return;
    setPir({ kind: "running" });
    try {
      const t0 = performance.now();
      const isMatchedQuery = currentLookup.kind === "ok" && currentLookup.matched.length > 0;
      const idx = isMatchedQuery && currentLookup.kind === "ok"
        ? Number(BigInt(currentLookup.matched[0].hash) & BigInt(CHAIN.treeMaxItems - 1))
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
  const busy = lookup.kind === "loading" || pir.kind === "running";

  return (
    <section className="bg-bg">
      <FadeStyle />
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        {/* Hero */}
        <div className="pt-20 sm:pt-28 pb-16">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Demo · PPOI status
          </p>
          <h1 className="mt-5 font-serif text-5xl sm:text-6xl lg:text-[5.5rem] leading-[0.98] tracking-tight max-w-[18ch] font-normal">
            Close the
            <br />
            address leak.
          </h1>
          <p className="mt-7 text-fg-secondary text-lg leading-relaxed max-w-[58ch]">
            Stop POSTing your blinded commitments to the PPOI server. Replace
            with a private retrieval against the same status table.
          </p>
        </div>

        {/* Step 01 - Paste */}
        <Step num="01" kicker="Paste an address">
          <div className="mt-8 flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1 max-w-2xl flex flex-col gap-1.5">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                ethereum address
              </span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.trim())}
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input) debouncedRun(input);
                }}
                disabled={busy}
                className="bg-bg-secondary border border-fg-faint px-3 py-2.5 font-mono text-[0.85rem] text-fg outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={() => debouncedRun(input || SAMPLE_ADDRESS)}
              disabled={busy || !boot.isReady(PPOI_INSTANCE)}
              className="inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 py-3.5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {!boot.isReady(PPOI_INSTANCE)
                ? "Preparing keys"
                : lookup.kind === "loading"
                ? "Scanning"
                : pir.kind === "running"
                ? "Running PIR"
                : "Run demo"}
              <ArrowRight size={13} />
            </button>
          </div>
        </Step>

        {/* Step 02 - What changes */}
        <Step num="02" kicker="What changes">
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-px bg-fg-faint border border-fg-faint">
            <div className="bg-bg p-8 sm:p-10 border-l-2 border-public">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                Stock wallet
              </span>
              <p className="mt-5 text-fg-secondary leading-relaxed">
                Every refresh POSTs the wallet&apos;s full blinded-commitment list to
                the PPOI server. The server clusters by IP and ties shield-derived
                BCs back to the on-chain depositor address.
              </p>
            </div>
            <div className="bg-bg p-8 sm:p-10 border-l-2 border-accent">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                Raven
              </span>
              <p className="mt-5 text-fg-secondary leading-relaxed">
                The wallet looks up its row index locally, then PIR-queries that
                row. The operator holds the bearer but never sees which row was
                requested.
              </p>
            </div>
          </div>
        </Step>

        {/* Step 03 - Result */}
        <Step num="03" kicker="Result">
          {lookup.kind === "error" ? (
            <div className="mt-8 border border-error/40 bg-error/5 p-5 text-[0.85rem] text-fg-secondary">
              <strong className="text-error">lookup failed</strong> · {lookup.message}
            </div>
          ) : pir.kind === "error" ? (
            <div className="mt-8 border border-error/40 bg-error/5 p-5 text-[0.85rem] text-fg-secondary">
              <strong className="text-error">PIR failed</strong> · {pir.message}
            </div>
          ) : pir.kind === "ok" ? (
            <div className="mt-8 rr-fade-in">
              <div className="flex items-start gap-5">
                <span className="inline-flex w-10 h-10 items-center justify-center border border-success/40 bg-success/10 shrink-0 mt-1">
                  <Check size={18} className="text-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                    Blinded commitment at row {pir.targetRow}
                  </div>
                  <div className="mt-3 font-mono text-[0.95rem] sm:text-[1.05rem] tabular-nums break-all text-fg leading-relaxed">
                    0x{pir.recoveredHex}
                  </div>
                </div>
              </div>
              <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-fg-faint border border-fg-faint">
                <ResultStat label="time" value={formatLatency(pir.totalMs)} />
                <ResultStat label="bytes up" value={formatBytes(pir.queryBytes)} />
                <ResultStat label="bytes down" value={formatBytes(pir.responseBytes)} />
                <ResultStat label="operator learned" value="nothing" tone="accent" />
              </div>
            </div>
          ) : (
            <p className="mt-8 text-fg-muted">Run step 01 to populate.</p>
          )}
        </Step>

        {/* Single technical-details disclosure */}
        <details className="mb-24 border border-fg-faint bg-bg-secondary group">
          <summary className="cursor-pointer list-none flex items-center gap-5 px-6 sm:px-8 py-6 hover:bg-bg-hover transition-colors">
            <span className="inline-flex w-9 h-9 items-center justify-center border border-accent/50 text-accent font-mono text-lg shrink-0 group-open:rotate-45 transition-transform">
              +
            </span>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-[0.78rem] uppercase tracking-[0.22em] text-fg font-mono font-medium">
                Show technical details
              </span>
              <span className="text-[0.78rem] text-fg-secondary">
                Cluster view · per-stage card · FAQ with citations
              </span>
            </div>
          </summary>
          <div className="px-6 sm:px-8 pt-8 pb-10 space-y-8 border-t border-fg-faint">
            <div className="text-fg-secondary leading-relaxed max-w-[72ch]">
              <p>
                Every balance refresh, the stock Railgun wallet POSTs the full list of blinded
                commitments it owns to the PPOI server. The server clusters those commitments by
                source IP and learns the wallet&apos;s UTXO set. For shield-derived commitments,
                the server can also tie the cluster back to the on-chain depositor address. Raven
                substitutes the per-IP POST with private retrieval against the same status table
                held by <code className="font-mono text-[0.85rem]">{PPOI_INSTANCE}</code>.
              </p>
            </div>

            <BootIndicator primaryInstance={PPOI_INSTANCE} />

            {lookup.kind === "ok" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-fg-faint border border-fg-faint">
                <div className="bg-public-dim border-l-2 border-public p-5">
                  <div className="text-[0.55rem] uppercase tracking-[0.18em] text-public font-mono mb-2">
                    what the PPOI operator sees today
                  </div>
                  <h3 className="font-serif text-xl mb-3">Cluster: {shortHex(lookup.address, 6, 4)}</h3>
                  {lookup.matched.length === 0 ? (
                    <p className="text-fg-secondary text-[0.85rem] leading-relaxed">
                      No matches in the last {formatNumber(lookup.scannedShields)} shields
                      (blocks {formatNumber(lookup.scannedFrom)}-{formatNumber(lookup.scannedTo)}).
                    </p>
                  ) : (
                    <>
                      <p className="text-fg-secondary text-[0.85rem] leading-relaxed mb-4">
                        {formatNumber(lookup.matched.length)} Shield
                        {lookup.matched.length === 1 ? "" : "s"} this address originated within the
                        last {formatNumber(lookup.scannedShields)} on-chain shields. Every balance
                        refresh, the wallet POSTs all of these to the PPOI operator.
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

                <div className="bg-private-dim border-r-2 border-private p-5">
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
                  {pir.kind === "ok" && (
                    <div className="mt-3 text-[0.6rem] uppercase tracking-[0.14em] font-mono">
                      {pir.isMatchedQuery ? (
                        <span className="text-success">queried row {pir.targetRow} · derived from your matched BC</span>
                      ) : (
                        <span className="text-warning">queried row {pir.targetRow} · wire-shape demo (address not matched)</span>
                      )}
                    </div>
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
                    <p>
                      Server runs an NTT-domain matrix-vector multiply over the encrypted index
                      against the {formatBytes(PIR_TABLES.ppoiStatusBytes)} blinded-commitment
                      table (one 32 B blinded commitment per row, ordered by the public
                      per-list mapping). The operator never sees which row was requested.
                    </p>
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
                              indexed at the wallet&apos;s row index. The status enum lives in a
                              public per-list <code className="font-mono text-[0.78rem]">ListStatusHeader</code>
                              {" "}the wallet bulk-downloads once per epoch and consults locally.
                            </p>
                            <HexBlock hex={`0x${pir.recoveredHex}`} label="blinded commitment at row" defaultOpen />
                          </div>
                        ),
                      }
                    : undefined
                }
              />
            )}

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
                  batch. The server clusters these K opaque IDs as one wallet at IP X. The cluster
                  grows monotonically as the wallet acquires UTXOs. Combined with the on-chain
                  shield-derived BC-to-EOA mapping, the cluster bridges to a real Ethereum address.
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
        </details>
      </div>
    </section>
  );
}

function Step({
  num,
  kicker,
  children,
}: {
  num: string;
  kicker: string;
  children: React.ReactNode;
}) {
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

function ResultStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="bg-bg p-5 sm:p-6">
      <div className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
        {label}
      </div>
      <div
        className={`mt-3 font-mono text-[20px] tabular-nums leading-tight ${
          tone === "accent" ? "text-accent" : "text-fg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function FadeStyle() {
  return (
    <style>{`@keyframes rr-fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.rr-fade-in{animation:rr-fade-in .45s ease-out}`}</style>
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
