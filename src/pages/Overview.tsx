import { Link } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";

export function Overview() {
  return (
    <section className="bg-bg">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        <div className="pt-20 sm:pt-28 pb-16">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
            Raven · adapter for Railgun
          </p>
          <h1 className="mt-5 font-serif text-5xl sm:text-6xl lg:text-[6rem] leading-[0.98] tracking-tight max-w-[16ch] font-normal">
            Private reads
            <br />
            for Railgun.
          </h1>
          <p className="mt-7 text-fg-secondary text-lg leading-relaxed max-w-[58ch]">
            A drop-in adapter that lets a Railgun wallet ask the chain what it
            needs, without letting the operator know who or what was asked for.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 items-center">
            <Link
              to="/commit-tree"
              className="inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 py-3.5 hover:bg-transparent hover:text-fg transition-colors"
            >
              Try a private query
              <ArrowRight size={13} />
            </Link>
            <Link
              to="/architecture"
              className="inline-flex items-center gap-2.5 border border-fg-faint text-fg-secondary text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 py-3.5 hover:border-fg hover:text-fg transition-colors"
            >
              How it works
            </Link>
          </div>
        </div>

        <div className="pb-12 grid grid-cols-1 md:grid-cols-3 gap-px bg-fg-faint border border-fg-faint">
          <Pillar
            kicker="Wallet integration"
            value="1 line"
            detail="Swap the upstream PPOI base URL. No protocol fork, no contract changes, no new wallet APIs."
          />
          <Pillar
            kicker="What the operator sees"
            value="opaque ciphertext"
            detail="No commitment hex, no row index, no wallet address, no IP cluster. Just encrypted bytes on the wire."
          />
          <Pillar
            kicker="Where it runs"
            value="mainnet, today"
            detail="Live adapter at raven.hisoka.io against the live Railgun proxy. Three demos below run against this same instance."
          />
        </div>

        <div className="mt-12 mb-16 border border-fg-faint bg-bg-secondary p-5 sm:p-6 flex flex-col sm:flex-row gap-4 items-start">
          <Terminal size={16} className="text-accent shrink-0 mt-1" />
          <div className="flex-1">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-fg-muted font-mono mb-2">
              Try this on every demo
            </p>
            <p className="text-fg-secondary text-[0.92rem] leading-relaxed">
              Open DevTools before you click run. Ctrl+Shift+I or F12 on Windows
              and Linux; Cmd+Opt+I on macOS. Pin the Network tab and watch the
              POST going to <code className="font-mono text-[0.85rem] text-fg">/v1/instance/.../query</code>.
              The body is opaque ciphertext, no row index, no commitment hex.
              Search it for any blinded commitment you know. There are none.
            </p>
          </div>
        </div>

        <div className="pt-4 pb-24">
          <div className="flex items-baseline justify-between pb-5 border-b border-fg-faint">
            <span className="text-[0.7rem] uppercase tracking-[0.22em] text-fg-secondary font-mono font-medium">
              Three demos
            </span>
            <span className="text-[0.65rem] uppercase tracking-[0.18em] text-fg-muted font-mono">
              Each one runs live in your browser
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 border-b border-fg-faint">
            <DemoCard
              to="/commit-tree"
              kicker="01 · Commit-tree"
              title="Private fetch of Merkle paths"
              desc="The wallet pulls a 16-sibling auth path privately, folds it locally with Poseidon, and asks mainnet whether the resulting root has ever been pinned by the contract."
            />
            <DemoCard
              to="/ppoi-status"
              kicker="02 · PPOI status"
              title="Close the address leak"
              desc="Stop POSTing your blinded commitments to the PPOI server every refresh. The same lookup runs as a private retrieval against the same status table."
            />
            <DemoCard
              to="/ppoi-path"
              kicker="03 · PPOI path"
              title="Hide the spend"
              desc="The operator no longer learns which UTXO you are about to spend before the block confirms. The 16-sibling path lookup goes encrypted end-to-end."
              last
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Pillar({
  kicker,
  value,
  detail,
}: {
  kicker: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-bg p-6 sm:p-7 flex flex-col gap-3">
      <span className="text-[0.6rem] uppercase tracking-[0.2em] text-fg-muted font-mono">
        {kicker}
      </span>
      <span className="font-serif text-[1.85rem] leading-[1.1] text-fg">
        {value}
      </span>
      <p className="text-fg-secondary text-[0.85rem] leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

function DemoCard({
  to,
  kicker,
  title,
  desc,
  last,
}: {
  to: string;
  kicker: string;
  title: string;
  desc: string;
  last?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group flex flex-col gap-4 p-8 sm:p-10 hover:bg-bg-secondary transition-colors ${
        last ? "" : "md:border-r"
      } border-fg-faint border-b md:border-b-0`}
    >
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-secondary font-mono font-medium">
        {kicker}
      </span>
      <h3 className="font-serif text-[1.85rem] leading-[1.15] font-normal mt-1">
        {title}
      </h3>
      <p className="text-fg-secondary text-[0.92rem] leading-relaxed flex-1">
        {desc}
      </p>
      <span className="mt-4 text-[0.72rem] uppercase tracking-[0.14em] text-accent font-mono font-medium inline-flex items-center gap-2 group-hover:gap-3 transition-all">
        Run demo
        <ArrowRight size={13} />
      </span>
    </Link>
  );
}
