import { Link } from "react-router-dom";
import { ArrowRight, GitMerge, Layers, ShieldCheck, Terminal } from "lucide-react";
import { useEventsStream } from "@/lib/use-events-stream";
import { CHAIN, PIR_BENCH, WALLET_FOOTPRINT } from "@/lib/numbers";
import { formatBytes } from "@/lib/format";

export function Overview() {
  const { status } = useEventsStream();
  const live = status?.instances.find((i) => i.role === "live" && i.id === `commit-tree-${CHAIN.liveTreeIndex}`);

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 space-y-6">
            <p className="text-[0.65rem] uppercase tracking-[0.22em] text-fg-muted font-mono">
              raven · adapter beneath railgun&apos;s wallet sdk
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
              Private reads for the Railgun stack.
            </h1>
            <p className="text-fg-secondary text-lg sm:text-xl leading-relaxed max-w-3xl">
              PIR substitution for PPOI status, PPOI Merkle paths, and on-chain commitment-tree auth paths.
              Wallet integration in one line. Operators no longer learn which UTXOs you queried.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                to="/commit-tree"
                className="inline-flex items-center gap-2 border border-fg text-fg text-[0.7rem] font-semibold uppercase tracking-[0.06em] px-4 py-2.5 hover:bg-fg hover:text-bg transition-colors"
              >
                Verifiable commit-tree path
                <ArrowRight size={12} />
              </Link>
              <Link
                to="/ppoi-status"
                className="inline-flex items-center gap-2 border border-fg-faint text-fg-secondary text-[0.7rem] font-semibold uppercase tracking-[0.06em] px-4 py-2.5 hover:border-fg hover:text-fg transition-colors"
              >
                PPOI status leak
                <ArrowRight size={12} />
              </Link>
              <Link
                to="/operator"
                className="inline-flex items-center gap-2 border border-fg-faint text-fg-secondary text-[0.7rem] font-semibold uppercase tracking-[0.06em] px-4 py-2.5 hover:border-fg hover:text-fg transition-colors"
              >
                Live operator state
                <ArrowRight size={12} />
              </Link>
            </div>
          </div>

          <aside className="lg:col-span-4 space-y-3 lg:pt-8">
            <NumberRow
              label="Wallet footprint today"
              value={`~${formatBytes(WALLET_FOOTPRINT.perDeviceRawBytes)} raw`}
              detail={`across ${CHAIN.staticTrees} filled + 1 live commit-tree on Ethereum mainnet`}
            />
            <NumberRow
              label="Per private query (server)"
              value={`${PIR_BENCH.serverRespondMs.toFixed(0)} ms`}
              detail={`up ${formatBytes(PIR_BENCH.upBytes)} / down ${formatBytes(PIR_BENCH.downBytes)} encrypted`}
            />
            <NumberRow
              label="Live commit-tree epoch"
              value={live ? `epoch ${live.epoch}` : "loading"}
              detail={live ? `instance ${live.id} active` : "from /v1/events"}
            />
          </aside>
        </div>

        <div className="mt-12 border border-fg-faint bg-bg-secondary p-4 sm:p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <Terminal size={16} className="text-accent shrink-0 mt-1 sm:mt-0" />
          <p className="text-[0.78rem] text-fg-secondary leading-relaxed">
            <span className="text-fg-muted uppercase tracking-wider text-[0.6rem] mr-2">try this</span>
            Open DevTools (Cmd/Ctrl+Option+I), pin the Network tab, fire any private query below.
            Inspect the POST body. Search it for any blinded commitment hex you know.
            There are none.
          </p>
        </div>

        <h2 className="mt-14 mb-4 font-serif text-2xl text-fg-secondary">Three demos</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-fg-faint">
          <DemoCard
            to="/commit-tree"
            icon={<GitMerge size={18} className="text-accent" />}
            title="Commit-tree path"
            subtitle="The mobile-wallet enabler"
            desc="PIR-fetch the on-chain Merkle auth path. Recover 16 sibling hashes, fold locally, ask mainnet `rootHistory(N, root)` whether it agrees. The chain answers true."
            cta="Verify on mainnet"
          />
          <DemoCard
            to="/ppoi-status"
            icon={<ShieldCheck size={18} className="text-accent" />}
            title="PPOI status"
            subtitle="The balance-refresh leak"
            desc="Stock wallets POST every blinded commitment they own to the PPOI server every refresh. Same IP, same wallet identity. Raven substitutes a private retrieval against the same table."
            cta="See the address leak"
          />
          <DemoCard
            to="/ppoi-path"
            icon={<Layers size={18} className="text-accent" />}
            title="PPOI Merkle path"
            subtitle="The spend-time leak"
            desc="Stock wallets reveal which UTXO they are spending before chain confirms. Raven substitutes a 16-sibling private retrieval; the operator does not learn which input is moving."
            cta="Fire a private query"
          />
        </div>

        <p className="mt-10 text-[0.7rem] text-fg-muted leading-relaxed max-w-3xl">
          The chain already publishes shield commitments in plaintext (Railgun&apos;s `Shield`
          event includes `npk` clear). The leak Raven closes is the wallet&apos;s own POSTs to
          the PPOI server, which carry per-IP UTXO clusters and spend-time inputs. Read more
          inside each tab.
          Manageable for desktop wallets while volume stays low. At anything approaching
          100k tx/day, mobile wallets cannot keep up. PIR removes the local-IMT requirement.
        </p>
      </div>
    </section>
  );
}

function NumberRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-fg-faint bg-bg-secondary px-4 py-3">
      <div className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono">{label}</div>
      <div className="mt-1 font-serif text-2xl text-fg">{value}</div>
      <div className="text-[0.7rem] text-fg-muted mt-0.5">{detail}</div>
    </div>
  );
}

function DemoCard({
  to,
  icon,
  title,
  subtitle,
  desc,
  cta,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  desc: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="bg-bg-secondary p-5 sm:p-6 hover:bg-bg-card transition-colors flex flex-col gap-3 group"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted font-mono">
          {subtitle}
        </span>
      </div>
      <h3 className="font-serif text-2xl">{title}</h3>
      <p className="text-fg-secondary text-[0.85rem] leading-relaxed flex-1">{desc}</p>
      <div className="text-[0.7rem] uppercase tracking-[0.06em] text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
        {cta}
        <ArrowRight size={12} />
      </div>
    </Link>
  );
}
