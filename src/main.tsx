import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ToastProvider } from "@/components/ui/Toast";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { BootProvider } from "@/lib/boot-context";
import { Overview } from "@/pages/Overview";
import { CommitTreePath } from "@/pages/CommitTreePath";
import { PpoiStatus } from "@/pages/PpoiStatus";
import { PpoiPath } from "@/pages/PpoiPath";
import { Operator } from "@/pages/Operator";
import { Architecture } from "@/pages/Architecture";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: "commit-tree", element: <CommitTreePath /> },
      { path: "ppoi-status", element: <PpoiStatus /> },
      { path: "ppoi-path", element: <PpoiPath /> },
      { path: "operator", element: <Operator /> },
      { path: "architecture", element: <Architecture /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <BootProvider>
          <RouterProvider router={router} />
        </BootProvider>
      </TooltipProvider>
    </ToastProvider>
  </StrictMode>
);
