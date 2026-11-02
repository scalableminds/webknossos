import { Drawer } from "antd";
import { useMinScreenWidth } from "libs/react_hooks";
import type React from "react";

// Below the md breakpoint (e.g., on phones), the dashboard sidebars don't fit next to the list.
export function useIsCompactDashboard(): boolean {
  return !useMinScreenWidth("md");
}

// Renders a dashboard sidebar inline on wide screens and inside a drawer on compact ones.
export function ResponsiveSidebar({
  isCompact,
  isOpen,
  onClose,
  title,
  placement,
  children,
}: {
  isCompact: boolean;
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  placement: "left" | "right";
  children: React.ReactNode;
}) {
  if (!isCompact) {
    return children;
  }
  return (
    <Drawer
      title={title}
      placement={placement}
      size="min(400px, 90vw)"
      open={isOpen}
      onClose={onClose}
      // The sidebars run effects (e.g., initializing the active folder) that must also happen
      // while the drawer is closed, just like on wide screens.
      forceRender
      className="dashboard-sidebar-drawer"
    >
      {children}
    </Drawer>
  );
}
