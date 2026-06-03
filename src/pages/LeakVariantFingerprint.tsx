import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Loader2 } from "lucide-react";
import { CONFIG } from "@/lib/config";
import { decodeHttpResponse } from "@/lib/http-response";
import { getNoxClient } from "@/lib/nox";
import { useNoxClient } from "@/hooks/useNoxClient";
import { useClientIp } from "@/hooks/useClientIp";
import { useNoxNodes } from "@/hooks/useNoxNodes";
import {
  ARTIFACTS_CID,
  CITATIONS_VERIFIED_AT,
  L3_CITATIONS,
  RAILGUN_VARIANT_TOTAL,
  VARIANT_MATRIX_CITATION,
  VARIANT_SHAPES,
  WALLET_SUBSET_CITATION,
  WALLET_VARIANT_SUBSET,
  artifactKinds,
  artifactUrl,
  permalink,
  variantString,
  type ArtifactKind,
  type VariantShape,
} from "@/lib/leak-data";
import { BeforeAfterPane } from "@/components/leaks/BeforeAfterPane";
import { IpDetails } from "@/components/leaks/IpDetails";
import { CitationFooter } from "@/components/leaks/CitationFooter";
import { NoxRouteVisualizer } from "@/components/leaks/NoxRouteVisualizer";
import { OperatorPerspective } from "@/components/leaks/OperatorPerspective";
import { WireFormatBlock, type WireResult } from "@/components/leaks/WireFormatBlock";

type CacheState = "cold" | "warm";
type ArtifactResults = Record<ArtifactKind, WireResult>;

const VKEY_GAP = permalink("wallet", "src/services/artifacts/artifact-hash.ts", "L52-L54");
const NOX_EXPECTED_BYTES = 16_384;
const NOX_RANGE = "bytes=0-8191";

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  zkey: "proving key",
  wasm: "witness wasm",
  vkey: "verification key",
  dat: "native witness",
};

function idleResults(): ArtifactResults {
  return { zkey: { kind: "idle" }, wasm: { kind: "idle" }, vkey: { kind: "idle" }, dat: { kind: "idle" } };
}

function fillResults(value: WireResult): ArtifactResults {
  return { zkey: value, wasm: value, vkey: value, dat: value };
}

async function fireDirectArtifact(gateway: string, kind: ArtifactKind, shape: VariantShape): Promise<WireResult> {
  const url = artifactUrl(gateway, kind, shape);
  const start = performance.now();
  try {
    const resp = await fetch(url, { method: "GET" });
    const declared = resp.headers.get("content-length");
    const size = declared ? Number(declared) : (await resp.arrayBuffer()).byteLength;
    const latencyMs = performance.now() - start;
    return { kind: "done", status: resp.status, latencyMs, bytes: size };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

function headerGet(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function totalSizeFromHeaders(headers: Record<string, string>, fallback: number): number {
  const range = headerGet(headers, "content-range");
  if (range) {
    const match = range.match(/\/(\d+)\s*$/);
    if (match) return Number(match[1]);
  }
  const length = headerGet(headers, "content-length");
  if (length) return Number(length);
  return fallback;
}

async function fireNoxArtifact(gateway: string, kind: ArtifactKind, shape: VariantShape): Promise<WireResult> {
  const url = artifactUrl(gateway, kind, shape);
  const start = performance.now();
  try {
    const client = await getNoxClient();
    const raw = await client.httpRequest(
      "GET",
      url,
      [
        ["accept", "*/*"],
        ["range", NOX_RANGE],
      ],
      new Uint8Array(0),
      { expectedResponseBytes: NOX_EXPECTED_BYTES },
    );
    const decoded = decodeHttpResponse(raw);
    const latencyMs = performance.now() - start;
    const size = totalSizeFromHeaders(decoded.headers, decoded.body.length);
    return { kind: "done", status: decoded.status, latencyMs, bytes: size };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export function LeakVariantFingerprint(): ReactElement {
  const nox = useNoxClient();
  const clientIp = useClientIp();
  const noxNodes = useNoxNodes();
  const [shape, setShape] = useState<VariantShape>(VARIANT_SHAPES[1]);
  const [cache, setCache] = useState<CacheState>("cold");
  const [before, setBefore] = useState<ArtifactResults>(idleResults());
  const [after, setAfter] = useState<ArtifactResults>(idleResults());
  const [firedAt, setFiredAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const gateway = CONFIG.ipfsGateway;
  const operator = useMemo(() => hostOf(gateway, "ipfs-lb.com"), [gateway]);
  const variant = variantString(shape);
  const samplePath = `/ipfs/${ARTIFACTS_CID.slice(0, 6)}.../prover/snarkjs/${variant}.wasm.br`;

  const beforeIpValue = clientIp.data?.ip ?? "your public IP";
  const beforeIpInfo =
    clientIp.data && clientIp.data.details.length > 0 ? (
      <IpDetails heading="what the gateway can resolve from your IP" rows={clientIp.data.details} />
    ) : undefined;
  const afterIpValue = noxNodes ? noxNodes.exit : "a NOX exit node";
  const afterIpInfo = noxNodes ? (
    <IpDetails
      heading="shared NOX exit pool"
      rows={noxNodes.exitIps.map((ip, i) => ({ label: `exit ${i + 1}`, value: ip }))}
      note="NOX picks a fresh 3-hop route per packet (entry, mix, exit). ipfs-lb records one of these exit IPs, shared across every NOX user. Your IP never reaches it."
    />
  ) : undefined;

  async function run(): Promise<void> {
    if (running) return;
    const ts = new Date().toISOString();
    setFiredAt(ts);

    if (cache === "warm") {
      const skipped: WireResult = { kind: "skipped", note: "would not fire (cached on disk)" };
      setBefore(fillResults(skipped));
      setAfter(fillResults(skipped));
      return;
    }

    setRunning(true);
    setBefore(fillResults({ kind: "loading", note: "GET ipfs-lb.com" }));
    setAfter(fillResults({ kind: "loading", note: "connecting to NOX" }));
    void nox.connect();
    const kinds = artifactKinds();
    await Promise.all(
      kinds.flatMap((k) => [
        fireDirectArtifact(gateway, k, shape).then((r) => setBefore((s) => ({ ...s, [k]: r }))),
        fireNoxArtifact(gateway, k, shape).then((r) => setAfter((s) => ({ ...s, [k]: r }))),
      ]),
    );
    setRunning(false);
  }

  const noxNote = nox.status === "connecting" ? "connecting to NOX (WASM + live topology)" : "routing through Sphinx 3-hop";

  return (
    <section className="bg-bg">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        <div className="pt-14 sm:pt-20 pb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Transport layer · The variant fingerprint
          </p>
          <h1 className="mt-4 font-serif text-4xl sm:text-5xl lg:text-[3.75rem] leading-[1.02] tracking-tight max-w-[22ch] font-normal">
            The download that previews your transaction.
          </h1>
          <p className="mt-6 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[70ch]">
            Before building any shielded transaction the wallet fetches circuit artifacts from a
            single hardcoded gateway. The filename carries the transaction shape: nullifier count by
            commitment count. The gateway operator learns your IP and the exact shape, roughly thirty
            seconds before the transaction lands on chain.
          </p>
          <p className="mt-3 text-fg-secondary text-[1.02rem] leading-relaxed max-w-[70ch]">
            Pick a shape. The left pane fetches the four real artifacts straight from{" "}
            <span className="font-mono text-fg">{operator}</span>. The right pane fetches the same
            files through the NOX mixnet, so the gateway sees the variant but not who asked for it.
            There are{" "}
            <ContextLink href={VARIANT_MATRIX_CITATION.upstreamUrl}>{RAILGUN_VARIANT_TOTAL} variants</ContextLink>{" "}
            in total; the wallet ships{" "}
            <ContextLink href={WALLET_SUBSET_CITATION.upstreamUrl}>{WALLET_VARIANT_SUBSET}</ContextLink>.
          </p>
        </div>

        <Section num="01" kicker="Pick a transaction shape">
          <div className="mt-8 grid grid-cols-3 sm:grid-cols-6 gap-2 max-w-[40rem]">
            {VARIANT_SHAPES.map((s) => {
              const active = s.nullifiers === shape.nullifiers && s.commitments === shape.commitments;
              return (
                <button
                  key={variantString(s)}
                  type="button"
                  onClick={() => setShape(s)}
                  disabled={running}
                  className={`flex flex-col items-center gap-0.5 px-2 py-3 border transition-colors disabled:opacity-40 ${
                    active ? "border-accent bg-accent-dim text-fg" : "border-fg-faint text-fg-secondary hover:text-fg hover:border-fg-muted"
                  }`}
                >
                  <span className="font-mono text-[0.95rem] tabular-nums">{variantString(s)}</span>
                  <span className="text-[0.55rem] uppercase tracking-[0.1em] text-fg-muted">
                    {s.nullifiers} in {s.commitments} out
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
                cache state
              </span>
              <div className="flex">
                <CacheButton label="cold (force re-fetch)" active={cache === "cold"} onClick={() => setCache("cold")} disabled={running} />
                <CacheButton label="warm (already cached)" active={cache === "warm"} onClick={() => setCache("warm")} disabled={running} />
              </div>
            </div>
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="h-11 inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 hover:bg-transparent hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fg disabled:hover:text-bg"
            >
              {running ? "Fetching artifacts" : cache === "warm" ? "Show cached run" : "Fetch the artifacts"}
              {running ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
            </button>
          </div>
        </Section>

        <Section num="02" kicker="Four artifacts, two transports">
          <div className="mt-8">
            <BeforeAfterPane
              before={
                <>
                  {artifactKinds().map((k) => (
                    <ArtifactRow key={k} kind={k} url={artifactUrl(gateway, k, shape)} result={before[k]} />
                  ))}
                  <OperatorPerspective
                    operator={operator}
                    tone="leak"
                    learns={[
                      { label: "ip", value: beforeIpValue, emphasis: true, info: beforeIpInfo },
                      { label: "path", value: samplePath, emphasis: true },
                      { label: "variant", value: `${variant} (${shape.nullifiers} in, ${shape.commitments} out)`, emphasis: true },
                      { label: "timestamp", value: firedAt ?? "(set on run)" },
                    ]}
                    note="The variant in the path is the transaction shape, tied to your real IP, fetched roughly thirty seconds before the transaction lands on chain."
                  />
                </>
              }
              after={
                <>
                  <NoxRouteVisualizer entry={noxNodes?.entry} mix={noxNodes?.mix} exit={noxNodes?.exit} />
                  {artifactKinds().map((k) => (
                    <ArtifactRow
                      key={k}
                      kind={k}
                      url={artifactUrl(gateway, k, shape)}
                      result={after[k].kind === "loading" ? { kind: "loading", note: noxNote } : after[k]}
                    />
                  ))}
                  <p className="text-[0.66rem] text-fg-muted leading-relaxed font-mono">
                    Sizes are the gateway-reported total. The exit node issues the GET that ipfs-lb
                    logs against the variant path; NOX requests a byte range so the mixnet round trip
                    stays interactive (status 206).
                  </p>
                  <OperatorPerspective
                    operator={operator}
                    tone="shielded"
                    learns={[
                      { label: "ip", value: afterIpValue, info: afterIpInfo },
                      { label: "path", value: samplePath, emphasis: true },
                      { label: "variant", value: `${variant} (${shape.nullifiers} in, ${shape.commitments} out)`, emphasis: true },
                      { label: "timestamp", value: firedAt ?? "(set on run)" },
                    ]}
                    note="The exit node IP is shared across the entire NOX user base. The gateway still sees the variant; it can no longer bind it to your IP or the transaction you are about to send."
                  />
                </>
              }
            />
            {cache === "warm" ? (
              <p className="mt-3 text-[0.78rem] text-fg-muted leading-relaxed max-w-[72ch]">
                On a warm cache no request fires, so the gateway learns nothing this run. The leak is
                per session, not per transaction: every cold start, every fresh install, every cleared
                cache is a re-leak of the next transaction shape.
              </p>
            ) : null}
          </div>
        </Section>

        <Section num="03" kicker="The key nobody checks">
          <aside className="mt-8 border border-warning/40 bg-warning/5 px-5 py-4 max-w-[78ch]">
            <p className="text-[0.9rem] text-fg-secondary leading-relaxed">
              The verification key is fetched like the others, but the wallet&apos;s{" "}
              <span className="font-mono text-fg">artifact-hash.ts</span> returns true unconditionally
              for the vkey, so its hash is never validated. A compromised gateway can swap the vkey and
              the wallet accepts it. The NOX adapter can pin and check the hash the wallet skips.
            </p>
            <a
              href={VKEY_GAP}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[0.8rem] text-warning hover:text-accent-light font-mono"
            >
              artifact-hash.ts:52-54
              <ArrowUpRight size={12} />
            </a>
          </aside>
        </Section>

        <div className="pb-24">
          <CitationFooter citations={L3_CITATIONS} verifiedAt={CITATIONS_VERIFIED_AT} />
        </div>
      </div>
    </section>
  );
}

function ArtifactRow({ kind, url, result }: { kind: ArtifactKind; url: string; result: WireResult }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.6rem] uppercase tracking-[0.16em] text-fg-muted font-mono">{ARTIFACT_LABEL[kind]}</span>
      <WireFormatBlock method="GET" url={url} headers={[["accept", "*/*"]]} result={result} />
    </div>
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

function CacheButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-11 px-4 border text-[0.72rem] font-mono transition-colors disabled:opacity-40 ${
        active ? "border-accent text-fg bg-accent-dim" : "border-fg-faint text-fg-secondary hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function ContextLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-light underline decoration-fg-faint underline-offset-2">
      {children}
    </a>
  );
}
