import { InboxOutlined, LockOutlined, UnlockOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { unwrapOrThrow } from "admin/api/api_result";
import { getUnversionedAnnotationInformation } from "admin/rest_api";
import { Space, Spin, Tag, Typography } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import { stringToTagColor } from "libs/colors";
import type React from "react";
import type { AnnotationCollaborationMode, APIAnnotationInfo, APIUser } from "types/api_types";
import { getStatsOfAnnotationInfo } from "viewer/model/accessors/annotation_accessor";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import { AnnotationStats } from "viewer/view/right_border_tabs/info_tab/annotation_stats_section";
import { AnnotationIdentity } from "viewer/view/right_border_tabs/info_tab/identity_block";

// Worded like the options of the share modal.
const COLLABORATION_MODE_LABELS: Record<
  Exclude<AnnotationCollaborationMode, "OwnerOnly">,
  string
> = {
  Exclusive: "Everybody who can view",
  Concurrent: "Everybody who can view, simultaneously",
};

export function AnnotationDetailsSidebar({
  annotation,
  activeUser,
  tags,
  onRename,
  onArchive,
  onToggleLock,
}: {
  annotation: APIAnnotationInfo | null;
  activeUser: APIUser;
  // The (editable) tags, rendered by the list so that they behave the same in both places.
  tags: React.ReactNode;
  // Only passed if the annotation may be renamed by the active user.
  onRename?: (newName: string) => void;
  // Actions are only passed if they are available for the annotation.
  onArchive?: () => Promise<void>;
  onToggleLock?: () => Promise<void>;
}) {
  if (annotation == null) {
    return (
      <div className="dashboard-details-sidebar text-center">
        <Typography.Text type="secondary">Select an annotation to see its details.</Typography.Text>
      </div>
    );
  }

  return (
    <div className="dashboard-details-sidebar">
      {/* The key resets the fetched details when another annotation is selected. */}
      <AnnotationDetails
        key={annotation.id}
        annotation={annotation}
        activeUser={activeUser}
        tags={tags}
        onRename={onRename}
        onArchive={onArchive}
        onToggleLock={onToggleLock}
      />
    </div>
  );
}

function AnnotationDetails({
  annotation,
  activeUser,
  tags,
  onRename,
  onArchive,
  onToggleLock,
}: {
  annotation: APIAnnotationInfo;
  activeUser: APIUser;
  // The (editable) tags, rendered by the list so that they behave the same in both places.
  tags: React.ReactNode;
  onRename?: (newName: string) => void;
  onArchive?: () => Promise<void>;
  onToggleLock?: () => Promise<void>;
}) {
  // The compact annotation from the list is kept up to date by the list (e.g. after renaming),
  // so the full info is only used for what the compact one lacks (the contributors).
  const { data: fullAnnotation, isFetching } = useQuery({
    queryKey: ["annotationInfo", annotation.id],
    queryFn: async () => unwrapOrThrow(await getUnversionedAnnotationInformation(annotation.id)),
    refetchOnWindowFocus: false,
    meta: { persist: false },
  });
  const contributors = fullAnnotation?.contributors ?? [];
  const stats = getStatsOfAnnotationInfo(annotation);

  return (
    <Spin spinning={isFetching}>
      {/* The description is stored in the tracing store, so it can only be edited in the annotation view. */}
      <AnnotationIdentity
        name={annotation.name}
        description={annotation.description}
        onChangeName={onRename}
        hideEmptyDescription
      />
      <div style={{ marginBottom: 4 }}>
        <div className="sidebar-label">ID</div>
        <Tag variant="outlined">
          <FormattedId id={annotation.id} />
        </Tag>
      </div>
      <div style={{ marginBottom: 4 }}>
        <div className="sidebar-label">Created</div>
        <FormattedDate timestamp={annotation.created} />
      </div>
      <div style={{ marginBottom: 4 }}>
        <div className="sidebar-label">Last Modified</div>
        <FormattedDate timestamp={annotation.modified} />
      </div>
      {annotation.owner != null ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Owner</div>
          <div>{formatUserName(activeUser, annotation.owner)}</div>
        </div>
      ) : null}
      {contributors.length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Contributors</div>
          <div>{contributors.map((user) => formatUserName(activeUser, user)).join(", ")}</div>
        </div>
      ) : null}
      {annotation.collaborationMode !== "OwnerOnly" ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Who can edit</div>
          <div>{COLLABORATION_MODE_LABELS[annotation.collaborationMode]}</div>
        </div>
      ) : null}
      {annotation.teams.length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Access Permissions</div>
          <Space wrap size="small">
            {annotation.teams.map((team) => (
              <Tag key={team.id} color={stringToTagColor(team.name)} variant="outlined">
                {team.name}
              </Tag>
            ))}
          </Space>
        </div>
      ) : null}
      {Object.keys(stats).length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Statistics</div>
          <AnnotationStats stats={stats} withMargin={false} orientation="horizontal" />
        </div>
      ) : null}
      {tags != null ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Tags</div>
          {tags}
        </div>
      ) : null}
      {onArchive != null || onToggleLock != null ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Additional Actions</div>
          <div className="dataset-table-actions">
            {onArchive != null ? (
              <AsyncLink onClick={onArchive} icon={<InboxOutlined className="icon-margin-right" />}>
                Archive
              </AsyncLink>
            ) : null}
            {onToggleLock != null ? (
              <AsyncLink
                onClick={onToggleLock}
                icon={
                  annotation.isLockedByOwner ? (
                    <UnlockOutlined className="icon-margin-right" />
                  ) : (
                    <LockOutlined className="icon-margin-right" />
                  )
                }
              >
                {annotation.isLockedByOwner ? "Unlock" : "Lock"}
              </AsyncLink>
            ) : null}
          </div>
        </div>
      ) : null}
    </Spin>
  );
}
