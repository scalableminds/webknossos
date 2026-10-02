import type React from "react";

// A labelled section of a dashboard details sidebar.
export function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="dashboard-details-section">
      <div className="sidebar-label">{label}</div>
      <div className="dashboard-details-section-content">{children}</div>
    </div>
  );
}
