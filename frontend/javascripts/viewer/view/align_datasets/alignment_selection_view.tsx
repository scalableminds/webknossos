import { PlayCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  createLayerAlignment,
  editAnnotation,
  editLockedState,
  finishAnnotation,
  getDataset,
  getLayerAlignments,
} from "admin/rest_api";
import { Alert, Flex, Spin, Typography } from "antd";
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
import { EDIT_BLOCKER_ACTION_LABELS, resolveAlignmentEditBlocker } from "./alignment_helpers";
import { ErrorMessage } from "./alignment_view";
import { getAlignmentEditBlocker, getAlignmentViewUrl } from "./bigwarp_protocol";
import { LayerPairPicker } from "./layer_pair_picker";

const ALIGNING_LAYERS_DOCS_URL =
  "https://docs.webknossos.org/webknossos/datasets/aligning_layers.html";

// Lists the alignment annotations of a dataset and creates new ones.
function AlignmentSelectionView() {
  const { datasetNameAndId = "" } = useParams();
  const { datasetId } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);

  const datasetQuery = useQuery({
    queryKey: ["alignDatasets", "dataset", datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: datasetId != null,
  });
  const dataset = datasetQuery.data;

  if (datasetId == null) {
    return (
      <ErrorMessage text="This page needs a dataset id in the URL. Please open it via the dataset actions menu in the dataset list in the dashboard." />
    );
  }
  if (datasetQuery.isError) {
    return <ErrorMessage text="Could not load this dataset." />;
  }
  if (dataset == null) {
    return <Spin style={{ margin: 40 }} />;
  }
  if (!dataset.isActive) {
    return <ErrorMessage text="This dataset is not active, so its layers cannot be aligned." />;
  }
  return <AlignmentSelection dataset={dataset} />;
}

function AlignmentSelection({ dataset }: { dataset: APIDataset }) {
  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [fixedLayerName, setFixedLayerName] = useState<string | null>(null);
  const [movingLayerName, setMovingLayerName] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const alignmentsQuery = useQuery({
    queryKey: ["alignDatasets", "layerAlignments", dataset.id],
    queryFn: () => getLayerAlignments(dataset.id),
    meta: { persist: false },
  });
  const alignments = alignmentsQuery.data ?? [];
  const refetchAlignments = () => alignmentsQuery.refetch();

  const alignmentsOfSelectedPair = alignments.filter(
    ({ layerAlignment }) =>
      (fixedLayerName == null || layerAlignment?.fixedLayerName === fixedLayerName) &&
      (movingLayerName == null || layerAlignment?.movingLayerName === movingLayerName),
  );
  const shownAlignments = alignmentsOfSelectedPair.filter(
    (annotation) => (annotation.state === "Finished") === showArchived,
  );
  const selectedAnnotation =
    alignments.find((annotation) => annotation.id === selectedAnnotationId) ?? null;

  const openAlignment = (annotationId: string) =>
    navigate(getAlignmentViewUrl(dataset, annotationId));

  const createAlignment = async (fixed: string, moving: string) => {
    try {
      const annotation = await createLayerAlignment(dataset.id, {
        fixedLayerName: fixed,
        movingLayerName: moving,
      });
      openAlignment(annotation.id);
    } catch (error) {
      handleGenericError(error as Error, "Could not create the alignment annotation.");
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
    await refetchAlignments();
  };

  const renderActions = (annotation: APIAnnotationInfo) => {
    const editBlocker = getAlignmentEditBlocker(annotation, activeUser.id);
    if (editBlocker == null) {
      return (
        <div className="annotation-row-actions">
          <Link to={getAlignmentViewUrl(dataset, annotation.id)}>
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
              openAlignment(await resolveAlignmentEditBlocker(annotation, editBlocker));
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
        <Typography.Title level={3}>Align layers of “{dataset.name}”</Typography.Title>
        {dataset.dataSource.dataLayers.length > 2 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, width: "100%", maxWidth: 800 }}
            title="Aligning more than two layers"
            description={
              <>
                Choose one layer as the fixed reference layer and align every other layer to it, one
                pair at a time, for example layer 2 → layer 1 and then layer 3 → layer 1. Aligning a
                layer to a layer that was moved itself is not supported yet.{" "}
                <a href={ALIGNING_LAYERS_DOCS_URL} target="_blank" rel="noopener noreferrer">
                  Learn more
                </a>
              </>
            }
          />
        ) : null}
        <LayerPairPicker
          dataset={dataset}
          fixedLayerName={fixedLayerName}
          movingLayerName={movingLayerName}
          onChange={(fixed, moving) => {
            setFixedLayerName(fixed);
            setMovingLayerName(moving);
          }}
          existingAlignmentCount={
            alignmentsOfSelectedPair.filter((annotation) => annotation.state === "Active").length
          }
          onCreate={createAlignment}
        />
      </Flex>
      <Typography.Title level={4} style={{ marginTop: 32 }}>
        Existing alignments
      </Typography.Title>
      <div className="dashboard-list-with-sidebar">
        <div>
          <AnnotationList
            annotations={shownAlignments}
            activeUser={activeUser}
            isAdminView={false}
            isLoading={alignmentsQuery.isLoading}
            hasMoreAnnotations={false}
            searchQuery=""
            tags={tags}
            onTagsChange={setTags}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
            renderActions={renderActions}
            emptyPlaceholder={
              <Typography.Text type="secondary">
                {fixedLayerName != null || movingLayerName != null
                  ? "There are no alignments for the selected layers yet."
                  : "There are no alignments for this dataset yet."}
              </Typography.Text>
            }
            onClearFilters={() => {
              setTags([]);
              setShowArchived(false);
            }}
            hideAlignmentPrefix
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

export default AlignmentSelectionView;
