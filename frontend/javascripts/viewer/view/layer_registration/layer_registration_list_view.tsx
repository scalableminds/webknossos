import { PlayCircleOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { unwrapOrThrow } from "admin/api/api_result";
import {
  createLayerRegistration,
  editAnnotation,
  editLockedState,
  finishAnnotation,
  getDataset,
  getLayerRegistrations,
} from "admin/rest_api";
import { Alert, Button, Flex, Input, Modal, Select, Space, Typography } from "antd";
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
import { useApi, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import without from "lodash-es/without";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { APIAnnotationInfo, APIDataset, APIUser } from "types/api_types";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { APPLY_EXPLANATION } from "./helpers/layer_registration_helpers";
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

// Creates a new layer registration annotation after the user selected its fixed layer. If there
// are layer registrations to that layer already, the modal offers to continue one of them.
function CreateLayerRegistrationModal({
  dataset,
  layerRegistrations,
  activeUserId,
  onOpen,
  onCreate,
  onClose,
}: {
  dataset: APIDataset;
  layerRegistrations: APIAnnotationInfo[];
  activeUserId: string;
  onOpen: (annotationId: string) => void;
  onCreate: (fixedLayerName: string) => Promise<void>;
  onClose: () => void;
}) {
  // The first layer is preselected, so that a new layer registration needs only one click.
  const [fixedLayerName, setFixedLayerName] = useState<string | null>(
    dataset.dataSource.dataLayers[0]?.name ?? null,
  );
  const existingLayerRegistrations = layerRegistrations.filter(
    (annotation) =>
      annotation.state === "Active" &&
      annotation.layerRegistration?.fixedLayerName === fixedLayerName,
  );
  const hasExistingLayerRegistrations = existingLayerRegistrations.length > 0;

  return (
    <Modal
      open
      title="New layer registration"
      onCancel={onClose}
      footer={
        <Flex justify="end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <AsyncButton
            type={hasExistingLayerRegistrations ? "default" : "primary"}
            disabled={fixedLayerName == null}
            onClick={async () => {
              if (fixedLayerName != null) {
                await onCreate(fixedLayerName);
              }
            }}
          >
            Create and open
          </AsyncButton>
        </Flex>
      }
    >
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Typography.Text>
          Select the primary ("fixed") layer. The other layers of the dataset become secondary
          ("moving") layers and are registered to it, one after the other. {APPLY_EXPLANATION} We
          recommend the layer that overlaps with the most other layers. The primary layer can't be
          changed later.
        </Typography.Text>
        <Typography.Text strong>Primary ("fixed") layer</Typography.Text>
        <Select
          placeholder="Primary layer"
          style={{ width: "100%" }}
          value={fixedLayerName ?? undefined}
          onChange={(value) => setFixedLayerName(value ?? null)}
          options={dataset.dataSource.dataLayers.map(({ name }) => ({ value: name, label: name }))}
        />
        {hasExistingLayerRegistrations ? (
          <Alert
            type="info"
            showIcon
            title={
              existingLayerRegistrations.length === 1
                ? "A layer registration to this layer already exists. Usually one is enough, so consider continuing it instead."
                : `${existingLayerRegistrations.length} layer registrations to this layer already exist. Usually one is enough, so consider continuing one of them instead.`
            }
            description={
              <Flex vertical gap={4}>
                {existingLayerRegistrations.map((annotation) => (
                  <Flex key={annotation.id} justify="space-between" gap={12}>
                    <Typography.Text ellipsis>
                      {annotation.name || "Unnamed annotation"}
                    </Typography.Text>
                    <LayerRegistrationOpenAction
                      annotation={annotation}
                      dataset={dataset}
                      activeUserId={activeUserId}
                      onOpen={onOpen}
                    />
                  </Flex>
                ))}
              </Flex>
            }
          />
        ) : null}
      </Space>
    </Modal>
  );
}

// Runs an action on an annotation of the list, with a toast for the result. The action must throw
// if it fails.
type ChangeAnnotation = (change: () => Promise<unknown>, successMessage: string) => Promise<void>;

// Opens the layer registration, or first removes what keeps the user from working on it.
function LayerRegistrationOpenAction({
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
      <Link to={getLayerRegistrationViewUrl(dataset, annotation.id)}>
        <PlayCircleOutlined className="icon-margin-right" />
        Open
      </Link>
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
    <AsyncLink
      onClick={resolveEditBlockerAndOpen}
      icon={<PlayCircleOutlined className="icon-margin-right" />}
    >
      {EDIT_BLOCKER_ACTION_LABELS[editBlocker]}
    </AsyncLink>
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
    changeAnnotation(
      () => editAnnotation(id, typ, { tags: newTags }).then(unwrapOrThrow),
      "The tags were updated.",
    );
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
                () => editAnnotation(id, typ, { name }).then(unwrapOrThrow),
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
  const layerCount = dataset.dataSource.dataLayers.length;
  if (layerCount < 2) {
    return (
      <LayerRegistrationPageError
        text={`This dataset has only ${layerCount} ${pluralize("layer", layerCount)}, but registering layers needs at least 2.`}
      />
    );
  }
  return <LayerRegistrationList dataset={dataset} />;
}

function LayerRegistrationList({ dataset }: { dataset: APIDataset }) {
  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const layerRegistrationsQuery = useApi({
    queryKey: ["layerRegistration", "layerRegistrations", dataset.id],
    queryFn: () => getLayerRegistrations(dataset.id),
    meta: { persist: false },
  });
  const layerRegistrationLoadingError = layerRegistrationsQuery.error;
  const layerRegistrations = layerRegistrationsQuery.data ?? [];
  const refetchLayerRegistrations = () => layerRegistrationsQuery.refetch();

  const shownLayerRegistrations = layerRegistrations.filter(
    (annotation) => (annotation.state === "Finished") === showArchived,
  );
  const selectedAnnotation =
    shownLayerRegistrations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;

  const openLayerRegistration = (annotationId: string) =>
    navigate(getLayerRegistrationViewUrl(dataset, annotationId));

  const createAndOpenLayerRegistration = async (fixed: string) => {
    // On failure, createLayerRegistration already showed an error toast.
    const result = await createLayerRegistration(dataset.id, { fixedLayerName: fixed });
    if (result.ok) {
      openLayerRegistration(result.value.id);
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
      <Typography.Title level={3}>Register layers of “{dataset.name}”</Typography.Title>
      <Typography.Paragraph style={{ maxWidth: 720 }}>
        A layer registration holds the landmarks of all layers that are registered to one primary
        ("fixed") layer. {APPLY_EXPLANATION} Usually, one layer registration per dataset is enough.{" "}
        <a
          href="https://docs.webknossos.org/webknossos/datasets/registering_layers.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn more
        </a>
      </Typography.Paragraph>
      <div className="dashboard-list-with-sidebar">
        <div>
          <Flex justify="space-between" align="center" gap={16} style={{ marginBottom: 8 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Layer registrations
            </Typography.Title>
            <Flex gap={8}>
              <Input
                prefix={<SearchOutlined />}
                placeholder="Search layer registrations"
                allowClear
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                style={{ width: 240 }}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setIsCreateModalOpen(true)}
              >
                New layer registration
              </Button>
            </Flex>
          </Flex>
          {layerRegistrationLoadingError ? (
            <Typography.Text type="warning">
              Failed to load the existing layer registrations of dataset {dataset.name}.
            </Typography.Text>
          ) : (
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
                <div className="annotation-row-actions">
                  <LayerRegistrationOpenAction
                    annotation={annotation}
                    dataset={dataset}
                    activeUserId={activeUser.id}
                    onOpen={openLayerRegistration}
                  />
                </div>
              )}
              emptyPlaceholder={
                <Typography.Text type="secondary">
                  There are no layer registrations for this dataset yet.
                </Typography.Text>
              }
              onClearFilters={() => {
                setSearchQuery("");
                setTags([]);
                setShowArchived(false);
              }}
              hideLayerRegistrationPrefix
            />
          )}
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
      {isCreateModalOpen ? (
        <CreateLayerRegistrationModal
          dataset={dataset}
          layerRegistrations={layerRegistrations}
          activeUserId={activeUser.id}
          onOpen={openLayerRegistration}
          onCreate={createAndOpenLayerRegistration}
          onClose={() => setIsCreateModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default LayerRegistrationListView;
