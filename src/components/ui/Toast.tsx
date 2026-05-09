import * as T from "@radix-ui/react-toast";
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

interface ToastEntry {
  id: number;
  title: ReactNode;
  body?: ReactNode;
  variant?: "info" | "success" | "warn" | "error";
  durationMs?: number;
}

interface ToastApi {
  push(entry: Omit<ToastEntry, "id">): number;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const push = useCallback<ToastApi["push"]>((entry) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { ...entry, id }]);
    return id;
  }, []);
  const dismiss = useCallback<ToastApi["dismiss"]>((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <Ctx.Provider value={api}>
      <T.Provider swipeDirection="right" duration={Infinity}>
        {children}
        {items.map((item) => (
          <T.Root
            key={item.id}
            duration={item.durationMs ?? Infinity}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className={cn(
              "border bg-bg-card text-fg p-4 pr-9 shadow-2xl relative",
              "data-[state=open]:animate-slide-in",
              "data-[state=closed]:animate-fade-out",
              variantBorder(item.variant)
            )}
          >
            <T.Title className="font-medium text-[0.85rem]">{item.title}</T.Title>
            {item.body && (
              <T.Description className="mt-1 text-fg-secondary text-[0.75rem] leading-relaxed">
                {item.body}
              </T.Description>
            )}
            <T.Close
              className="absolute top-2 right-2 p-1 text-fg-muted hover:text-fg"
              aria-label="Close"
            >
              <X size={12} />
            </T.Close>
          </T.Root>
        ))}
        <T.Viewport className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(380px,90vw)]" />
      </T.Provider>
    </Ctx.Provider>
  );
}

function variantBorder(v?: ToastEntry["variant"]) {
  switch (v) {
    case "success":
      return "border-success/40";
    case "warn":
      return "border-warning/40";
    case "error":
      return "border-error/50";
    default:
      return "border-fg-faint";
  }
}
