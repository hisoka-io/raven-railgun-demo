import * as TP from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TP.Provider delayDuration={150}>{children}</TP.Provider>;
}

export function Tooltip({
  children,
  content,
  side = "top",
}: {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TP.Root>
      <TP.Trigger asChild>{children}</TP.Trigger>
      <TP.Portal>
        <TP.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-xs px-3 py-2 text-[0.72rem] leading-snug",
            "bg-bg-card border border-fg-faint text-fg shadow-xl",
            "data-[state=delayed-open]:animate-fade-in"
          )}
        >
          {content}
          <TP.Arrow className="fill-fg-faint" />
        </TP.Content>
      </TP.Portal>
    </TP.Root>
  );
}
