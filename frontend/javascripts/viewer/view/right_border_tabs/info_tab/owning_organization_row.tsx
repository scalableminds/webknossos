import { Tag } from "antd";
import FastTooltip from "components/fast_tooltip";

export function OwningOrganizationRow({ organizationId }: { organizationId: string | null }) {
  return (
    <FastTooltip title="Organization" placement="left">
      <div className="info-tab-block">
        <p className="sidebar-label">Organization</p>
        <p>
          <Tag color="blue" variant="outlined">
            {organizationId === null ? <i>loading...</i> : organizationId}
          </Tag>
        </p>
      </div>
    </FastTooltip>
  );
}
