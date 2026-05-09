import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export function HexBlock({
  hex,
  label,
  defaultOpen = false,
}: {
  hex: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const headPreview = clean.slice(0, 12);
  const tailPreview = clean.slice(-6);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
    }
  }

  return (
    <div className="bg-bg-input border border-fg-faint">
      <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[0.6rem] text-fg-muted font-mono">
        <span className="uppercase tracking-[0.14em]">{label ?? "hex"}</span>
        <div className="flex items-center gap-2">
          <span className="text-fg-secondary">
            {open ? `${clean.length} chars` : `${headPreview}...${tailPreview}`}
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="hover:text-fg transition-colors"
          >
            {open ? "collapse" : "show full"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="hover:text-fg transition-colors inline-flex items-center gap-1"
            aria-label="Copy"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
      </div>
      {open && (
        <div className={cn("px-3 py-2 font-mono text-[0.7rem] text-fg break-all leading-relaxed border-t border-fg-faint")}>
          {hex.startsWith("0x") ? "0x" : ""}
          {clean}
        </div>
      )}
    </div>
  );
}
