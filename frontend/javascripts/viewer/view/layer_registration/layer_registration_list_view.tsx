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
import { Divider, Flex, Input, Typography } from "antd";
import { AsyncLink } from "components/async_clickables";
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
import without from "lodash-es/without";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { APIAnnotationInfo, APIDataset } from "types/api_types";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import {
  EDIT_BLOCKER_ACTION_LABELS,
  getLayerRegistrationEditBlocker,
  resolveLayerRegistrationEditBlocker,
} from "./layer_registration_edit_blocker";
import { LayerRegistrationFixedLayerPicker } from "./layer_registration_fixed_layer_picker";
import {
  LayerRegistrationPageError,
  LayerRegistrationPageSpinner,
} from "./layer_registration_page_status_views";
import { getLayerRegistrationViewUrl } from "./layer_registration_protocol";

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

  // Runs an action on an annotation of the list and loads the list again afterwards.
  const changeAnnotation = async (change: () => Promise<unknown>, successMessage: string) => {
    try {
      await change();
      Toast.success(successMessage);
    } catch (error) {
      handleGenericError(error as Error);
    }
    await refetchLayerRegistrations();
  };

  const renderActions = (annotation: APIAnnotationInfo) => {
    const editBlocker = getLayerRegistrationEditBlocker(annotation, activeUser.id);
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
    return (
      <div className="annotation-row-actions">
        <AsyncLink
          onClick={async () => {
            try {
              openLayerRegistration(
                await resolveLayerRegistrationEditBlocker(annotation, editBlocker),
              );
            } catch (error) {
              handleGenericError(error as Error);
            }
          }}
          icon={<PlayCircleOutlined className="icon-margin-right" />}
        >
          {EDIT_BLOCKER_ACTION_LABELS[editBlocker]}
        </AsyncLink>
      </div>
    );
  };

  const renderEditableTags = (annotation: APIAnnotationInfo) => (
    <AnnotationTags
      annotation={annotation}
      isEditable={isAnnotationEditable(annotation, activeUser) && annotation.state === "Active"}
      onClickTag={(tag) =>
        setTags((previous) => (previous.includes(tag) ? previous : [...previous, tag]))
      }
      onAddTag={(tag) =>
        changeAnnotation(
          () => editAnnotation(annotation.id, annotation.typ, { tags: [...annotation.tags, tag] }),
          "The tags were updated.",
        )
      }
      onRemoveTag={(tag) =>
        changeAnnotation(
          () =>
            editAnnotation(annotation.id, annotation.typ, { tags: without(annotation.tags, tag) }),
          "The tags were updated.",
        )
      }
    />
  );

  return (
    <div className="container">
      <Flex vertical align="center">
        <Typography.Title level={3}>Register layers of “{dataset.name}”</Typography.Title>
        <LayerRegistrationFixedLayerPicker
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
            renderActions={renderActions}
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
        <AnnotationDetailsSidebar
          annotation={selectedAnnotation}
          activeUser={activeUser}
          isReadOnly={
            selectedAnnotation != null && !isAnnotationEditable(selectedAnnotation, activeUser)
          }
          tags={selectedAnnotation != null ? renderEditableTags(selectedAnnotation) : null}
          onRename={
            selectedAnnotation != null && isAnnotationEditable(selectedAnnotation, activeUser)
              ? (name) =>
                  changeAnnotation(
                    () => editAnnotation(selectedAnnotation.id, selectedAnnotation.typ, { name }),
                    "The annotation was renamed.",
                  )
              : undefined
          }
          onArchive={
            selectedAnnotation != null && mayArchiveAnnotation(selectedAnnotation, activeUser)
              ? () =>
                  changeAnnotation(
                    () => finishAnnotation(selectedAnnotation.id, selectedAnnotation.typ),
                    "The annotation was archived.",
                  )
              : undefined
          }
          onToggleLock={
            selectedAnnotation != null && mayLockAnnotation(selectedAnnotation, activeUser)
              ? () =>
                  changeAnnotation(
                    () =>
                      editLockedState(
                        selectedAnnotation.id,
                        selectedAnnotation.typ,
                        !selectedAnnotation.isLockedByOwner,
                      ),
                    selectedAnnotation.isLockedByOwner
                      ? "The annotation was unlocked."
                      : "The annotation was locked.",
                  )
              : undefined
          }
        />
      </div>
    </div>
  );
}

export default LayerRegistrationListView;
