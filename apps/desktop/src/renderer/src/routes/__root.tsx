import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@repo/ui/toast";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
