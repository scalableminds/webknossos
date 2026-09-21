import { useQuery } from "@tanstack/react-query";
import { getOrganization } from "admin/api/organization";
import { Tag } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";

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

export function OrganizationBlock() {
  const owningOrganization = useWkSelector((state) => state.dataset.owningOrganization);
  const activeUserOrganization = useWkSelector((state) => state.activeUser?.organization);
  const isOwnOrganization = activeUserOrganization === owningOrganization;

  const { data: organization } = useQuery({
    queryKey: ["organization", owningOrganization],
    queryFn: () => getOrganization(owningOrganization),
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: !isOwnOrganization,
  });

  if (isOwnOrganization) return null;

  return <OwningOrganizationRow organizationId={organization?.name ?? null} />;
}
