import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export function Overview() {
  return (
    <section className="bg-bg">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-14">
        {/* Hero */}
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
            needs &mdash; without telling the operator who is asking.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 items-center">
            <Link
              to="/ppoi-path"
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

        {/* Three demos */}
        <div className="pt-8 pb-24">
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
              num="01"
              kicker="Commit-tree"
              title="Verify on mainnet"
              desc="Fetch a Merkle auth path privately. Fold it locally. Ask mainnet if the root agrees."
            />
            <DemoCard
              to="/ppoi-status"
              num="02"
              kicker="PPOI status"
              title="Close the address leak"
              desc="Stop POSTing your blinded commitments to the PPOI server. Replace with a private retrieval."
            />
            <DemoCard
              to="/ppoi-path"
              num="03"
              kicker="PPOI path"
              title="Hide the spend"
              desc="The operator no longer learns which UTXO you are about to spend before chain confirms."
              last
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoCard({
  to,
  num,
  kicker,
  title,
  desc,
  last,
}: {
  to: string;
  num: string;
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
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-3xl text-accent leading-none">
          {num}
        </span>
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-secondary font-mono font-medium">
          {kicker}
        </span>
      </div>
      <h3 className="font-serif text-[2rem] leading-[1.1] font-normal mt-2">
        {title}
      </h3>
      <p className="text-fg-secondary text-[0.95rem] leading-relaxed flex-1">
        {desc}
      </p>
      <span className="mt-4 text-[0.72rem] uppercase tracking-[0.14em] text-accent font-mono font-medium inline-flex items-center gap-2 group-hover:gap-3 transition-all">
        Run demo
        <ArrowRight size={13} />
      </span>
    </Link>
  );
}
