import * as A from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { type ReactNode, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const AccordionRoot = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof A.Root>
>((props, ref) => (
  <A.Root
    ref={ref as React.Ref<HTMLDivElement>}
    {...props}
    className={cn("border border-fg-faint divide-y divide-fg-faint", props.className)}
  />
));
AccordionRoot.displayName = "AccordionRoot";

export function AccordionItem({
  value,
  trigger,
  children,
  defaultOpen = false,
}: {
  value: string;
  trigger: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <A.Item value={value} className="data-[state=open]:bg-bg-secondary">
      <A.Header>
        <A.Trigger
          className={cn(
            "w-full flex items-center justify-between text-left",
            "px-4 py-3 text-[0.85rem] font-medium",
            "hover:bg-bg-hover transition-colors",
            "data-[state=open]:bg-bg-secondary"
          )}
        >
          <span className="flex-1">{trigger}</span>
          <ChevronDown
            size={14}
            className="text-fg-muted transition-transform duration-200 data-[state=open]:rotate-180"
          />
        </A.Trigger>
      </A.Header>
      <A.Content
        forceMount={defaultOpen ? true : undefined}
        className="overflow-hidden text-[0.82rem] text-fg-secondary leading-relaxed data-[state=closed]:hidden"
      >
        <div className="px-4 pb-4 pt-1">{children}</div>
      </A.Content>
    </A.Item>
  );
}
