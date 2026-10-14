import { PlayCircleOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  createLayerRegistration,
  editAnnotation,
  editLockedState,
  finishAnnotation,
  getDataset,
  getLayerRegistrations,
} from "admin/rest_api";
import { Divider, Flex, Input, Select, Space, Typography } from "antd";
import { AsyncButton, AsyncLink } from "components/async_clickables";
import { AnnotationDetailsSidebar } from "dashboard/annotation_details_sidebar";
import {
  AnnotationList,
  isAnnotationEditable,
  mayArchiveAnnotation,
  mayLockAnnotation,
} from "dashboard/annotation_list";
import { AnnotationTags } from "dashboard/annotation_tags";
import { handleGenericError } from "libs/error_handling";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import without from "lodash-es/without";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { APIAnnotationInfo, APIDataset, APIUser } from "types/api_types";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import {
  EDIT_BLOCKER_ACTION_LABELS,
  getLayerRegistrationEditBlocker,
  resolveLayerRegistrationEditBlocker,
} from "./layer_registration_edit_blocker";
import {
  LayerRegistrationPageError,
  LayerRegistrationPageSpinner,
} from "./layer_registration_page_status_views";
import { getLayerRegistrationViewUrl } from "./layer_registration_protocol";

type FixedLayerPickerProps = {
  dataset: APIDataset;
  fixedLayerName: string | null;
  onChange: (fixedLayerName: string | null) => void;
  // The number of existing layer registration annotations for the selected fixed layer.
  existingLayerRegistrationCount: number;
  onCreate: (fixedLayerName: string) => Promise<void>;
};

// Selects the fixed layer of a new layer registration annotation. The selection also filters the
// list of existing layer registration annotations, so that the user sees them before creating a new
// one.
function FixedLayerPicker({
  dataset,
  fixedLayerName,
  onChange,
  existingLayerRegistrationCount,
  onCreate,
}: FixedLayerPickerProps) {
  const hasExistingLayerRegistrations =
    fixedLayerName != null && existingLayerRegistrationCount > 0;

  return (
    <Space orientation="vertical" style={{ width: "100%", maxWidth: 480 }}>
      <Typography.Text>
        Pick the fixed (reference) layer, which stays put. All other layers can then be registered
        to it, one after the other.
      </Typography.Text>
      <Select
        placeholder="Fixed layer (does not move)"
        style={{ width: "100%" }}
        allowClear
        value={fixedLayerName ?? undefined}
        onChange={(value) => onChange(value ?? null)}
        options={dataset.dataSource.dataLayers.map(({ name }) => ({ value: name, label: name }))}
      />
      {hasExistingLayerRegistrations ? (
        <Typography.Text type="secondary">
          {existingLayerRegistrationCount}{" "}
          {pluralize("layer registration", existingLayerRegistrationCount)} to this layer already{" "}
          {existingLayerRegistrationCount === 1 ? "exists" : "exist"} below. Consider continuing{" "}
          {existingLayerRegistrationCount === 1 ? "it" : "one of them"} instead of starting a new
          one.
        </Typography.Text>
      ) : null}
      <AsyncButton
        type={hasExistingLayerRegistrations ? "default" : "primary"}
        disabled={fixedLayerName == null}
        onClick={async () => {
          if (fixedLayerName != null) {
            await onCreate(fixedLayerName);
          }
        }}
      >
        {fixedLayerName != null
          ? `Create new layer registration to ${fixedLayerName}`
          : "Create new layer registration"}
      </AsyncButton>
    </Space>
  );
}

// Runs an action on an annotation of the list, with a toast for the result.
type ChangeAnnotation = (change: () => Promise<unknown>, successMessage: string) => Promise<void>;

// Opens the layer registration, or first removes what keeps the user from working on it.
function RowActions({
  annotation,
  dataset,
  activeUserId,
  onOpen,
}: {
  annotation: APIAnnotationInfo;
  dataset: APIDataset;
  activeUserId: string;
  onOpen: (annotationId: string) => void;
}) {
  const editBlocker = getLayerRegistrationEditBlocker(annotation, activeUserId);
  if (editBlocker == null) {
    return (
      <div className="annotation-row-actions">
        <Link to={getLayerRegistrationViewUrl(dataset, annotation.id)}>
          <PlayCircleOutlined className="icon-margin-right" />
          Open
        </Link>
      </div>
    );
  }
  const resolveEditBlockerAndOpen = async () => {
    try {
      onOpen(await resolveLayerRegistrationEditBlocker(annotation, editBlocker));
    } catch (error) {
      handleGenericError(error as Error);
    }
  };
  return (
    <div className="annotation-row-actions">
      <AsyncLink
        onClick={resolveEditBlockerAndOpen}
        icon={<PlayCircleOutlined className="icon-margin-right" />}
      >
        {EDIT_BLOCKER_ACTION_LABELS[editBlocker]}
      </AsyncLink>
    </div>
  );
}

// The details of the selected layer registration, with the changes that the user may make.
function LayerRegistrationDetailsSidebar({
  annotation,
  activeUser,
  changeAnnotation,
  onClickTag,
}: {
  annotation: APIAnnotationInfo | null;
  activeUser: APIUser;
  changeAnnotation: ChangeAnnotation;
  onClickTag: (tag: string) => void;
}) {
  if (annotation == null) {
    return (
      <AnnotationDetailsSidebar
        annotation={null}
        activeUser={activeUser}
        isReadOnly={false}
        tags={null}
      />
    );
  }
  const { id, typ, tags, isLockedByOwner } = annotation;
  const isEditable = isAnnotationEditable(annotation, activeUser);
  const updateTags = (newTags: string[]) =>
    changeAnnotation(() => editAnnotation(id, typ, { tags: newTags }), "The tags were updated.");
  return (
    <AnnotationDetailsSidebar
      annotation={annotation}
      activeUser={activeUser}
      isReadOnly={!isEditable}
      tags={
        <AnnotationTags
          annotation={annotation}
          isEditable={isEditable && annotation.state === "Active"}
          onClickTag={onClickTag}
          onAddTag={(tag) => updateTags([...tags, tag])}
          onRemoveTag={(tag) => updateTags(without(tags, tag))}
        />
      }
      onRename={
        isEditable
          ? (name) =>
              changeAnnotation(
                () => editAnnotation(id, typ, { name }),
                "The annotation was renamed.",
              )
          : undefined
      }
      onArchive={
        mayArchiveAnnotation(annotation, activeUser)
          ? () => changeAnnotation(() => finishAnnotation(id, typ), "The annotation was archived.")
          : undefined
      }
      onToggleLock={
        mayLockAnnotation(annotation, activeUser)
          ? () =>
              changeAnnotation(
                () => editLockedState(id, typ, !isLockedByOwner),
                isLockedByOwner ? "The annotation was unlocked." : "The annotation was locked.",
              )
          : undefined
      }
    />
  );
}

// Lists the layer registration annotations of a dataset and creates new ones.
function LayerRegistrationListView() {
  const { datasetNameAndId = "" } = useParams();
  const { datasetId } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);

  const datasetQuery = useQuery({
    queryKey: ["layerRegistration", "dataset", datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: datasetId != null,
  });
  const dataset = datasetQuery.data;

  if (datasetId == null) {
    return (
      <LayerRegistrationPageError text="This page needs a dataset id in the URL. Please open it via the dataset actions menu in the dataset list in the dashboard." />
    );
  }
  if (datasetQuery.isError) {
    return <LayerRegistrationPageError text="Could not load this dataset." />;
  }
  if (dataset == null) {
    return <LayerRegistrationPageSpinner />;
  }
  if (!dataset.isActive) {
    return (
      <LayerRegistrationPageError text="This dataset is not active, so its layers cannot be registered." />
    );
  }
  return <LayerRegistrationList dataset={dataset} />;
}

function LayerRegistrationList({ dataset }: { dataset: APIDataset }) {
  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  // The first layer is preselected, so that a new layer registration needs only one click. The
  // selection also filters the list, and clearing it shows the layer registrations to all layers.
  const [fixedLayerName, setFixedLayerName] = useState<string | null>(
    dataset.dataSource.dataLayers[0]?.name ?? null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const layerRegistrationsQuery = useQuery({
    queryKey: ["layerRegistration", "layerRegistrations", dataset.id],
    queryFn: () => getLayerRegistrations(dataset.id),
    meta: { persist: false },
  });
  const layerRegistrations = layerRegistrationsQuery.data ?? [];
  const refetchLayerRegistrations = () => layerRegistrationsQuery.refetch();

  const layerRegistrationsOfSelectedLayer = layerRegistrations.filter(
    ({ layerRegistration }) =>
      fixedLayerName == null || layerRegistration?.fixedLayerName === fixedLayerName,
  );
  const shownLayerRegistrations = layerRegistrationsOfSelectedLayer.filter(
    (annotation) => (annotation.state === "Finished") === showArchived,
  );
  const selectedAnnotation =
    layerRegistrations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;

  const openLayerRegistration = (annotationId: string) =>
    navigate(getLayerRegistrationViewUrl(dataset, annotationId));

  const createAndOpenLayerRegistration = async (fixed: string) => {
    try {
      const annotation = await createLayerRegistration(dataset.id, { fixedLayerName: fixed });
      openLayerRegistration(annotation.id);
    } catch (error) {
      handleGenericError(error as Error, "Could not create the layer registration.");
    }
  };

  // Loads the list again after each change.
  const changeAnnotation: ChangeAnnotation = async (change, successMessage) => {
    try {
      await change();
      Toast.success(successMessage);
    } catch (error) {
      handleGenericError(error as Error);
    }
    await refetchLayerRegistrations();
  };

  return (
    <div className="container">
      <Flex vertical align="center">
        <Typography.Title level={3}>Register layers of “{dataset.name}”</Typography.Title>
        <FixedLayerPicker
          dataset={dataset}
          fixedLayerName={fixedLayerName}
          onChange={setFixedLayerName}
          existingLayerRegistrationCount={
            layerRegistrationsOfSelectedLayer.filter((annotation) => annotation.state === "Active")
              .length
          }
          onCreate={createAndOpenLayerRegistration}
        />
      </Flex>
      <Divider
        plain
        // The default divider color is barely visible in the light theme.
        style={{ marginBlock: 40, borderBlockStartColor: "var(--ant-color-border)" }}
      >
        or continue an existing layer registration
      </Divider>
      <div className="dashboard-list-with-sidebar">
        <div>
          <Flex justify="space-between" align="center" gap={16} style={{ marginBottom: 8 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Existing layer registrations
            </Typography.Title>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search layer registrations"
              allowClear
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              style={{ width: 240 }}
            />
          </Flex>
          <AnnotationList
            annotations={shownLayerRegistrations}
            activeUser={activeUser}
            isAdminView={false}
            isLoading={layerRegistrationsQuery.isLoading}
            hasMoreAnnotations={false}
            searchQuery={searchQuery}
            tags={tags}
            onTagsChange={setTags}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
            renderActions={(annotation) => (
              <RowActions
                annotation={annotation}
                dataset={dataset}
                activeUserId={activeUser.id}
                onOpen={openLayerRegistration}
              />
            )}
            emptyPlaceholder={
              <Typography.Text type="secondary">
                {fixedLayerName != null
                  ? "There are no layer registrations to the selected layer yet."
                  : "There are no layer registrations for this dataset yet."}
              </Typography.Text>
            }
            onClearFilters={() => {
              setSearchQuery("");
              setTags([]);
              setShowArchived(false);
            }}
            hideLayerRegistrationPrefix
          />
        </div>
        <LayerRegistrationDetailsSidebar
          annotation={selectedAnnotation}
          activeUser={activeUser}
          changeAnnotation={changeAnnotation}
          onClickTag={(tag) =>
            setTags((previous) => (previous.includes(tag) ? previous : [...previous, tag]))
          }
        />
      </div>
    </div>
  );
}

export default LayerRegistrationListView;
