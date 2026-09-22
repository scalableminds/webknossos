import { InfoTabRow } from "./info_tab_layout";

export function OwningOrganizationRow({ organizationId }: { organizationId: string | null }) {
  return (
    <InfoTabRow label="Organization" tooltip="The organization owning this dataset">
      {organizationId === null ? <i>loading…</i> : organizationId}
    </InfoTabRow>
  );
}
