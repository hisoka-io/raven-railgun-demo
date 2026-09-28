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
              to="/observer"
              className="inline-flex items-center gap-2.5 bg-fg text-bg border border-fg text-[0.78rem] font-semibold uppercase tracking-[0.08em] px-5 py-3.5 hover:bg-transparent hover:text-fg transition-colors"
            >
              Watch the wire
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
            value="1 install call"
            detail="The wallet installs Raven's POI interface after its engine starts. No engine change, no protocol fork, no contract changes."
          />
          <Pillar
            kicker="What the operator sees"
            value="encrypted queries"
            detail="No commitment and no row index. The operator still sees which 65,536-row block a query targets, sizes, timing and the IP."
          />
          <Pillar
            kicker="What stays the same"
            value="the aggregator"
            detail="Proof submission and transaction checks still go to Railgun's aggregator, exactly as today. Raven removes the reads, not the write."
          />
        </div>

        <div className="mt-12 mb-16 border border-fg-faint bg-bg-secondary p-5 sm:p-6 flex flex-col sm:flex-row gap-4 items-start">
          <Terminal size={16} className="text-accent shrink-0 mt-1" />
          <div className="flex-1">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-fg-muted font-mono mb-2">
              How the demo shows it
            </p>
            <p className="text-fg-secondary text-[0.92rem] leading-relaxed">
              The wire observer sits between the wallet and both servers and
              records every request. Each body is searched for the wallet's own
              blinded commitments. With Raven off, the aggregator receives them:
              every note on a fresh sync, each new note until it turns valid, and
              the notes each transfer spends. With Raven on, the requests to Raven
              are encrypted queries that name only a block, and none carries a commitment.
            </p>
          </div>
        </div>

        <div className="pt-4 pb-24">
          <div className="grid grid-cols-1 border-y border-fg-faint">
            <DemoCard
              to="/observer"
              kicker="Live demo · Terminal Wallet"
              title="Stock POI node against Raven, side by side"
              desc="The same wallet action twice: once with Raven off, once with it on. See every request each server received, and which of them named the wallet's notes."
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
