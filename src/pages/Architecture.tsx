import { useState } from "react";
import { cn } from "@/lib/cn";

type NodeKey = "wallet" | "sdk" | "raven" | "nox" | "mainnet";

interface NodeData {
  name: string;
  desc: string;
  eyebrow: string;
  role: string;
  solves: string[];
  skips: string[];
}

const DATA: Record<NodeKey, NodeData> = {
  wallet: {
    name: "Wallet",
    desc: "Any Railgun client",
    eyebrow: "Selected · client",
    role: "Any Railgun client. The wallet stays unmodified - no API surface change, no new dependencies in your app.",
    solves: ["Nothing on its own - privacy comes from the layers below."],
    skips: ["Without Raven and NOX, every read leaks who is asking what."],
  },
  sdk: {
    name: "Raven adapter SDK",
    desc: "1-line drop-in",
    eyebrow: "Selected · client",
    role: "A 1-line drop-in that replaces the default RPC adapter. Same shape, private retrieval underneath.",
    solves: [
      "Encrypts queries before they leave the client.",
      "Folds Merkle proofs locally.",
    ],
    skips: ["Cannot hide your IP - that's NOX's job."],
  },
  raven: {
    name: "raven.hisoka.io",
    desc: "query layer · private retrieval",
    eyebrow: "Selected · query layer",
    role: "The strict query layer. Wallet asks, Raven answers, the operator only ever sees ciphertext.",
    solves: [
      "Per-IP UTXO clustering at PPOI status lookup.",
      "Spend-time deanon at PPOI Merkle path lookup.",
      "Local IMT requirement on commit-tree auth-path lookup.",
    ],
    skips: [
      "Submission-side leaks - <code>submitTransactProof</code> still carries <code>blindedCommitmentsOut[]</code>. NOX covers this.",
      "Subsquid public-side data - that is, by design, public.",
    ],
  },
  nox: {
    name: "NOX",
    desc: "transport layer · sphinx mixnet",
    eyebrow: "Selected · transport layer",
    role: "A separate strict layer. Sphinx mixnet for transport-layer privacy - hides who is talking to whom.",
    solves: [
      "Submission-side metadata leaks at the network layer.",
      "Operator IP correlation across requests.",
    ],
    skips: ["What you read - that's Raven's job."],
  },
  mainnet: {
    name: "Ethereum mainnet",
    desc: "RailgunSmartWallet contract",
    eyebrow: "Selected · source of truth",
    role: "The contract is the authority. Roots verified locally against on-chain state.",
    solves: [
      "Provides the canonical commit-tree root.",
      "All proofs anchor here.",
    ],
    skips: ["Public by design. Not a privacy layer."],
  },
};

const STROKE = "rgba(232,229,224,0.16)";

export function Architecture() {
  const [active, setActive] = useState<NodeKey>("raven");
  const d = DATA[active];

  return (
    <section className="bg-bg">
      <div className="max-w-[880px] mx-auto px-4 sm:px-6 lg:px-10 pt-20 sm:pt-24 pb-24">
        {/* Hero */}
        <div>
          <p className="font-mono text-[0.75rem] font-medium uppercase tracking-[0.22em] text-fg-secondary">
            Where Raven sits
          </p>
          <h1 className="mt-4 font-serif text-6xl sm:text-7xl lg:text-[88px] leading-none tracking-tight font-normal">
            Architecture
          </h1>
          <p className="mt-7 text-fg-secondary text-lg leading-relaxed max-w-[56ch]">
            Two strict privacy layers, stacked. Raven hides{" "}
            <em className="font-serif italic">what you read</em>. NOX hides{" "}
            <em className="font-serif italic">how you send</em>. Wallet, contracts, and
            circuits stay unchanged.
          </p>
        </div>

        {/* Diagram */}
        <div className="mt-20 sm:mt-24 flex flex-col items-center">
          <NodeBtn k="wallet" active={active} onClick={setActive} data={DATA.wallet} />
          <Connector />
          <NodeBtn k="sdk" active={active} onClick={setActive} data={DATA.sdk} />
          <BranchSplit />
          <div className="grid grid-cols-1 sm:grid-cols-2 w-full max-w-[720px]">
            <NodeBtn k="raven" active={active} onClick={setActive} data={DATA.raven} />
            <div className="border-t sm:border-t-0 sm:border-l border-fg-faint">
              <NodeBtn k="nox" active={active} onClick={setActive} data={DATA.nox} />
            </div>
          </div>
          <BranchMerge />
          <NodeBtn
            k="mainnet"
            active={active}
            onClick={setActive}
            data={DATA.mainnet}
          />
        </div>

        {/* Detail */}
        <div className="mt-20 sm:mt-24 pt-10 sm:pt-12 border-t border-fg-faint">
          <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.22em] text-fg-muted">
            {d.eyebrow}
          </p>
          <h2 className="mt-3 font-serif text-5xl sm:text-6xl text-accent leading-[1.05] tracking-tight font-normal">
            {d.name}
          </h2>
          <p className="mt-4 mb-10 text-fg-secondary text-[1.0625rem] max-w-[56ch] leading-relaxed">
            {d.role}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-14">
            <ListBlock heading="What it solves" tone="green" items={d.solves} />
            <ListBlock heading="What it does not" tone="muted" items={d.skips} />
          </div>
        </div>
      </div>
    </section>
  );
}

function NodeBtn({
  k,
  active,
  onClick,
  data,
}: {
  k: NodeKey;
  active: NodeKey;
  onClick: (k: NodeKey) => void;
  data: NodeData;
}) {
  const isActive = active === k;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className="w-full max-w-[520px] text-center px-6 py-5 sm:py-6 transition-opacity hover:opacity-70 cursor-pointer"
    >
      <div
        className={cn(
          "font-serif text-2xl sm:text-[28px] leading-[1.1] font-normal",
          isActive ? "text-accent" : "text-fg"
        )}
      >
        {data.name}
      </div>
      <div className="mt-2 font-mono text-[0.75rem] text-fg-muted tracking-wide">
        {data.desc}
      </div>
    </button>
  );
}

function Connector() {
  return <div className="w-px h-12 bg-fg-faint" aria-hidden="true" />;
}

function BranchSplit() {
  return (
    <div className="hidden sm:block w-full max-w-[720px] h-12" aria-hidden="true">
      <svg
        viewBox="0 0 720 48"
        preserveAspectRatio="none"
        className="w-full h-full block"
      >
        <path
          d="M 360 0 L 360 24 L 180 24 L 180 48"
          stroke={STROKE}
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M 360 24 L 540 24 L 540 48"
          stroke={STROKE}
          strokeWidth="1"
          fill="none"
        />
      </svg>
    </div>
  );
}

function BranchMerge() {
  return (
    <div className="hidden sm:block w-full max-w-[720px] h-12" aria-hidden="true">
      <svg
        viewBox="0 0 720 48"
        preserveAspectRatio="none"
        className="w-full h-full block"
      >
        <path
          d="M 180 0 L 180 24 L 360 24 L 360 48"
          stroke={STROKE}
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M 540 0 L 540 24 L 360 24"
          stroke={STROKE}
          strokeWidth="1"
          fill="none"
        />
      </svg>
    </div>
  );
}

function ListBlock({
  heading,
  tone,
  items,
}: {
  heading: string;
  tone: "green" | "muted";
  items: string[];
}) {
  return (
    <div>
      <div
        className={cn(
          "font-mono text-[0.7rem] font-medium uppercase tracking-[0.22em] pb-3.5 border-b border-fg-faint mb-4",
          tone === "green" ? "text-success" : "text-fg-muted"
        )}
      >
        {heading}
      </div>
      <ul className="flex flex-col gap-3.5 list-none p-0 m-0 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-fg">
        {items.map((line, i) => (
          <li
            key={i}
            className="text-[0.95rem] text-fg-secondary leading-[1.55]"
            dangerouslySetInnerHTML={{ __html: line }}
          />
        ))}
      </ul>
    </div>
  );
}
