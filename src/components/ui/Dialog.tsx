import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
        <D.Content
          className={cn(
            "fixed top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2",
            "w-[min(92vw,720px)] max-h-[85vh] overflow-y-auto",
            "bg-bg-card border border-fg-faint p-6 z-50",
            "shadow-2xl"
          )}
        >
          <D.Title className="font-serif text-2xl mb-1">{title}</D.Title>
          {description && (
            <D.Description className="text-fg-secondary text-[0.85rem] mb-4">
              {description}
            </D.Description>
          )}
          {children}
          <D.Close
            className="absolute top-3 right-3 p-1 text-fg-muted hover:text-fg transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
