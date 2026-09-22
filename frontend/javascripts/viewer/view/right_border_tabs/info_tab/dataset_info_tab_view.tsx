import { InfoCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getOrganization } from "admin/api/organization";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { Link } from "react-router";
import type { APIUser, APIUserBase } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import { ControlModeEnum } from "viewer/constants";
import { mayEditAnnotationProperties } from "viewer/model/accessors/annotation_accessor";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import { AnnotationStatisticsSection } from "./annotation_stats_section";
import { DatasetAnnotationCountLink } from "./dataset_annotation_count_link";
import { DatasetExtentRow } from "./dataset_extent_row";
import { DebugInfo } from "./debug_info";
import {
  AnnotationIdentityBlock,
  DatasetIdentityBlock,
  DatasetSettingsButton,
} from "./identity_block";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";
import { KeyboardShortcutsSection } from "./keyboard_shortcuts_section";
import { MagInfoRow } from "./mag_info_row";
import { OwningOrganizationRow } from "./owning_organization_row";
import { VoxelSizeRow } from "./voxel_size_row";

const datasetInfoTabId = "dataset-info-tab";

const CONTRIBUTORS_EXPLANATION =
  'If other users edited this annotation, they will be listed here. You can allow other users to edit the annotation by opening the "Share" dialog from the dropdown menu.';

export default function DatasetInfoTabView() {
  const isDatasetViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );

  return (
    <div id={datasetInfoTabId} className="flex-overflow info-tab">
      <DomVisibilityObserver targetId={datasetInfoTabId}>
        {(isVisibleInDom) =>
          // Skip rendering entirely while the tab is hidden. The annotation identity block
          // keeps its own modal mounted, so it stays rendered while that modal is open.
          isVisibleInDom ? (
            <>
              {WkDevFlags.debugging.showCurrentVersionInInfoTab && <DebugInfo />}
              {isDatasetViewMode ? <DatasetInfoPanel /> : <AnnotationInfoPanel />}
            </>
          ) : null
        }
      </DomVisibilityObserver>
    </div>
  );
}

function DatasetInfoPanel() {
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);

  return (
    <>
      <DatasetIdentityBlock dataset={dataset} activeUser={activeUser} />
      <InfoTabSection label="Dataset">
        <VoxelSizeRow dataset={dataset} />
        <DatasetExtentRow dataset={dataset} />
        <MagInfoRow />
        <OrganizationRow />
        <DatasetAnnotationCountLink dataset={dataset} label="Annotations" />
      </InfoTabSection>
      <KeyboardShortcutsSection />
    </>
  );
}

function AnnotationInfoPanel() {
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);
  const task = useWkSelector((state) => state.task);
  const annotationName = useWkSelector((state) => state.annotation.name);
  const annotationDescription = useWkSelector((state) => state.annotation.description);
  const mayEditAnnotation = useWkSelector(mayEditAnnotationProperties);

  return (
    <>
      <AnnotationIdentityBlock
        name={annotationName}
        description={annotationDescription}
        mayEdit={mayEditAnnotation}
      />
      {task != null ? (
        <InfoTabSection label="Task">
          <InfoTabRow label="Task ID">{task.id}</InfoTabRow>
        </InfoTabSection>
      ) : null}
      <InfoTabSection
        label="Dataset"
        action={<DatasetSettingsButton dataset={dataset} activeUser={activeUser} />}
      >
        <InfoTabRow label="Name">
          <Link
            to={getViewDatasetURL(dataset)}
            title={`Click to view dataset ${dataset.name} without annotation`}
            style={{ fontWeight: 600 }}
          >
            {dataset.name}
          </Link>
        </InfoTabRow>
        <VoxelSizeRow dataset={dataset} />
        <DatasetExtentRow dataset={dataset} />
        <MagInfoRow />
        <OrganizationRow />
        <DatasetAnnotationCountLink dataset={dataset} label="Other annotations" />
      </InfoTabSection>
      <PeopleSection />
      <AnnotationStatisticsSection />
    </>
  );
}

/** Only relevant when the dataset belongs to a different organization than the active user. */
function OrganizationRow() {
  const owningOrganization = useWkSelector((state) => state.dataset.owningOrganization);
  const activeUserOrganization = useWkSelector((state) => state.activeUser?.organization);

  const { data: organization } = useQuery({
    queryKey: ["organization", owningOrganization],
    queryFn: () => getOrganization(owningOrganization),
    enabled: activeUserOrganization !== owningOrganization,
    refetchOnWindowFocus: false,
  });

  if (activeUserOrganization === owningOrganization) {
    return null;
  }

  return <OwningOrganizationRow organizationId={organization?.name ?? null} />;
}

function PeopleSection() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const owner = useWkSelector((state) => state.annotation.owner);
  const contributors = useWkSelector((state) => state.annotation.contributors);

  if (!owner) {
    return null;
  }

  return (
    <InfoTabSection label="People">
      <InfoTabRow label="Owner">
        <UserName user={owner} activeUser={activeUser} />
      </InfoTabRow>
      <InfoTabRow
        label="Contributors"
        labelSuffix={
          <FastTooltip title={CONTRIBUTORS_EXPLANATION}>
            <InfoCircleOutlined />
          </FastTooltip>
        }
      >
        {contributors.length > 0 ? (
          <span>
            {contributors.map((user, index) => (
              <span key={user.id}>
                {index > 0 ? ", " : ""}
                <UserName user={user} activeUser={activeUser} />
              </span>
            ))}
          </span>
        ) : (
          // Read-only values are plain text — a chip would promise a click that does not exist.
          <span className="info-tab-muted">None</span>
        )}
      </InfoTabRow>
    </InfoTabSection>
  );
}

function UserName({
  user,
  activeUser,
}: {
  user: APIUserBase;
  activeUser: APIUser | null | undefined;
}) {
  return (
    <span>
      {user.firstName} {user.lastName}
      {activeUser?.id === user.id ? <span className="info-tab-muted"> (you)</span> : null}
    </span>
  );
}
