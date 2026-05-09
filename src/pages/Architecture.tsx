import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";

interface Box {
  id: string;
  title: string;
  subtitle: string;
  solves: string[];
  doesNotSolve: string[];
  link?: { href: string; label: string };
}

const BOXES: Box[] = [
  {
    id: "wallet",
    title: "Wallet (any Railgun client)",
    subtitle: "engine + wallet sdk; unmodified",
    solves: [
      "Owns the recipient master key + viewing key.",
      "Implements the PoI workflow today; Raven swaps one URL.",
    ],
    doesNotSolve: [
      "Wallet boot still replays every shield/transact event before Raven; mobile wallets cannot keep up.",
      "PIR removes the local IMT requirement entirely.",
    ],
    link: {
      href: "https://github.com/Railgun-Community/engine",
      label: "@railgun-community/engine",
    },
  },
  {
    id: "raven-sdk",
    title: "Raven adapter SDK",
    subtitle: "@raven/railgun-poi-node-interface · 1-line drop-in",
    solves: [
      "Drop-in replacement for the wallet's PoI node contract; one URL changes.",
      "Owns the WASM cold path, IndexedDB warm path, and per-query path.",
      "Bearer-gated; no chain credentials touched.",
    ],
    doesNotSolve: [
      "Wallet UX (key management, broadcaster selection).",
      "Transport-layer privacy; that is NOX.",
    ],
  },
  {
    id: "raven-server",
    title: "raven.hisoka.io",
    subtitle: "axum + InsPIRe engine · 6 instances live",
    solves: [
      "Per-IP UTXO clustering at PPOI status lookup.",
      "Spend-time deanon at PPOI Merkle path lookup.",
      "Local IMT requirement on commit-tree auth-path lookup.",
    ],
    doesNotSolve: [
      "Submission-side leaks (submitTransactProof carries blindedCommitmentsOut[] today).",
      "Subsquid public-side data; that is by design public.",
    ],
  },
  {
    id: "nox",
    title: "NOX (separate project)",
    subtitle: "Sphinx mixnet for transport",
    solves: [
      "Source IP leak to broadcaster.",
      "Waku pubsub topic + relay timing correlation.",
    ],
    doesNotSolve: [
      "Query-level leaks; that is Raven.",
      "On-chain submission semantics.",
    ],
    link: { href: "https://hisoka.io/nox", label: "hisoka.io/nox" },
  },
  {
    id: "ppoi-mirror",
    title: "Indexer + PPOI mirror",
    subtitle: "alloy + reqwest · feeds Raven server state",
    solves: [
      "Pulls Shield/Transact events from Ethereum and PPOI events from upstream.",
      "Persists state via bincode-snapshot + WAL + manifest.",
    ],
    doesNotSolve: [
      "Operator does not run a public PPOI list itself; it mirrors Railgun&apos;s today.",
    ],
  },
  {
    id: "broadcaster",
    title: "Broadcaster network",
    subtitle: "out of scope for Raven",
    solves: [],
    doesNotSolve: [
      "Broadcaster sees IP + tx-bytes today; NOX closes this hop.",
      "Future: Waku integration paths (nwaku, rln).",
    ],
  },
  {
    id: "chain",
    title: "Ethereum mainnet",
    subtitle: "RailgunSmartWallet contract",
    solves: [
      "Anchors every commitment via Shield/Transact events.",
      "rootHistory(treeNumber, root) lets anyone verify a Merkle path was real.",
    ],
    doesNotSolve: [
      "Transact npk is encrypted, but Shield npk and EOA depositor are public.",
    ],
    link: {
      href: "https://etherscan.io/address/0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
      label: "0xfa70...4b9 on Etherscan",
    },
  },
];

export function Architecture() {
  const [active, setActive] = useState<string>("raven-server");
  const box = BOXES.find((b) => b.id === active)!;

  return (
    <section className="bg-bg">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-16">
        <div className="max-w-3xl mb-8">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono mb-2">
            where raven sits
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl mb-3">Architecture</h1>
          <p className="text-fg-secondary text-[0.95rem] leading-relaxed">
            Click any box for &quot;what it solves&quot; vs &quot;what it does not&quot;. Raven
            is one strict layer (private retrieval). NOX is a separate strict layer
            (transport). Together they cover both query-level and transport-level leaks; the
            wallet, contracts, and circuits stay unchanged.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-px bg-fg-faint">
          <div className="lg:col-span-7 bg-bg-secondary p-5">
            <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono mb-4">
              flow
            </div>
            <div className="space-y-2 font-mono text-[0.78rem]">
              <Layer
                title="[ Wallet (any Railgun client) ]"
                id="wallet"
                active={active}
                onClick={setActive}
              />
              <Arrow />
              <Layer
                title="[ Raven adapter SDK (1-line drop-in) ]"
                id="raven-sdk"
                active={active}
                onClick={setActive}
              />
              <Arrow />
              <div className="grid grid-cols-2 gap-2">
                <Layer
                  title="[ raven.hisoka.io ]"
                  id="raven-server"
                  active={active}
                  onClick={setActive}
                  multiline={["axum + InsPIRe engine", "private retrieval over CRS"]}
                />
                <Layer
                  title="[ NOX (separate) ]"
                  id="nox"
                  active={active}
                  onClick={setActive}
                  multiline={["Sphinx mixnet", "transport-layer privacy"]}
                />
              </div>
              <Arrow />
              <div className="grid grid-cols-2 gap-2">
                <Layer
                  title="[ Indexer + PPOI mirror ]"
                  id="ppoi-mirror"
                  active={active}
                  onClick={setActive}
                />
                <Layer
                  title="[ broadcaster network ]"
                  id="broadcaster"
                  active={active}
                  onClick={setActive}
                />
              </div>
              <Arrow />
              <Layer
                title="[ Ethereum mainnet ]"
                id="chain"
                active={active}
                onClick={setActive}
                multiline={["RailgunSmartWallet contract"]}
              />
            </div>
          </div>

          <div className="lg:col-span-5 bg-bg-secondary p-5">
            <div className="text-[0.55rem] uppercase tracking-[0.14em] text-fg-muted font-mono mb-2">
              {box.subtitle}
            </div>
            <h3 className="font-serif text-2xl mb-4">{box.title}</h3>
            <div className="space-y-4">
              <Section heading="what it solves" lines={box.solves} accent="success" />
              <Section heading="what it does not solve" lines={box.doesNotSolve} accent="warn" />
            </div>
            {box.link && (
              <a
                href={box.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-1 text-[0.78rem] text-accent hover:underline"
              >
                {box.link.label}
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Layer({
  title,
  id,
  active,
  onClick,
  multiline,
}: {
  title: string;
  id: string;
  active: string;
  onClick: (id: string) => void;
  multiline?: string[];
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        "w-full text-left px-3 py-2 border transition-colors",
        active === id
          ? "border-accent bg-accent-dim text-fg"
          : "border-fg-faint bg-bg hover:border-fg-muted text-fg-secondary"
      )}
    >
      <div>{title}</div>
      {multiline?.map((line) => (
        <div key={line} className="text-[0.7rem] text-fg-muted ml-2">
          {line}
        </div>
      ))}
    </button>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center text-fg-muted my-1">
      <ChevronRight className="rotate-90" size={14} />
    </div>
  );
}

function Section({
  heading,
  lines,
  accent,
}: {
  heading: string;
  lines: string[];
  accent: "success" | "warn";
}) {
  if (lines.length === 0) {
    return (
      <div>
        <div
          className={cn(
            "text-[0.55rem] uppercase tracking-[0.14em] font-mono mb-1",
            accent === "success" ? "text-success" : "text-warning"
          )}
        >
          {heading}
        </div>
        <p className="text-fg-muted text-[0.78rem]">(none in scope)</p>
      </div>
    );
  }
  return (
    <div>
      <div
        className={cn(
          "text-[0.55rem] uppercase tracking-[0.14em] font-mono mb-2",
          accent === "success" ? "text-success" : "text-warning"
        )}
      >
        {heading}
      </div>
      <ul className="space-y-1.5 text-[0.85rem] text-fg-secondary leading-relaxed">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className={cn("shrink-0", accent === "success" ? "text-success" : "text-warning")}>
              ·
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
