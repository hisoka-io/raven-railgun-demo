import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ToastProvider } from "@/components/ui/Toast";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { Overview } from "@/pages/Overview";
import { Observer } from "@/pages/Observer";
import { Architecture } from "@/pages/Architecture";
import { LeakSmokingGun } from "@/pages/LeakSmokingGun";
import { LeakVariantFingerprint } from "@/pages/LeakVariantFingerprint";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: "observer", element: <Observer /> },
      { path: "architecture", element: <Architecture /> },
      { path: "leak/smoking-gun", element: <LeakSmokingGun /> },
      { path: "leak/variant-fingerprint", element: <LeakVariantFingerprint /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ToastProvider>
  </StrictMode>
);
