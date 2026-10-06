import { useQuery } from "@tanstack/react-query";
import { getOrganization } from "admin/api/organization";
import { useWkSelector } from "libs/react_hooks";
import { InfoTabRow } from "./info_tab_layout";

// An organization's name practically never changes while a dataset is open, so the lookup
// is kept for the whole session instead of being refetched whenever the tab remounts.
const ORGANIZATION_STALE_TIME = Number.POSITIVE_INFINITY;

/** The plain row. The dashboard's dataset sidebar resolves the name on its own and uses this. */
export function OwningOrganizationRow({ organizationId }: { organizationId: string | null }) {
  return (
    <InfoTabRow label="Organization" tooltip="The organization owning this dataset">
      {organizationId === null ? <i>loading…</i> : organizationId}
    </InfoTabRow>
  );
}

/**
 * The viewer's variant, which resolves the name of the dataset in the store itself. It
 * renders nothing unless the dataset belongs to a different organization than the user.
 */
export function DatasetOwningOrganizationRow() {
  const owningOrganization = useWkSelector((state) => state.dataset.owningOrganization);
  const activeUserOrganization = useWkSelector((state) => state.activeUser?.organization);
  const isForeignOrganization = activeUserOrganization !== owningOrganization;

  const { data: organization } = useQuery({
    queryKey: ["organization", owningOrganization],
    queryFn: () => getOrganization(owningOrganization),
    enabled: isForeignOrganization,
    staleTime: ORGANIZATION_STALE_TIME,
    refetchOnWindowFocus: false,
  });

  if (!isForeignOrganization) {
    return null;
  }

  return <OwningOrganizationRow organizationId={organization?.name ?? null} />;
}
