import { useQuery } from "@tanstack/react-query";
import { getDataset, getUnversionedAnnotationInformation } from "admin/rest_api";
import { Space, Typography } from "antd";
import { AsyncButton } from "components/async_clickables";
import { handleGenericError } from "libs/error_handling";
import { useApi, useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { APIAnnotation } from "types/api_types";
import {
  type AlignmentEditBlocker,
  EDIT_BLOCKER_ACTION_LABELS,
  getAlignmentEditBlocker,
  getEditBlockerDescription,
  resolveAlignmentEditBlocker,
} from "./alignment_edit_blocker";
import {
  getActiveMovingLayerName,
  getMovingLayerNames,
  type LayerNames,
} from "./alignment_helpers";
import { AlignmentPageError, AlignmentPageSpinner } from "./alignment_page_status_views";
import { AlignmentWorkspace } from "./alignment_workspace";
import { getAlignmentViewUrl, MOVING_LAYER_URL_PARAM } from "./bigwarp_protocol";

/**  Aligns the layers of a dataset ("moving" layers) to one of its layers ("fixed" layer) by
 * placing matching landmarks in both, similar to the BigWarp plugin of Fiji. The landmarks are
 * stored in an alignment annotation, which belongs to the fixed layer and holds the landmarks
 * of all moving layers.
 * The page shows the fixed layer and one moving layer side by side, each in an iframe with a
 * sandbox annotation view ("worker", see bigwarp_worker.ts). The moving layer is chosen with
 * a URL param. The alignment annotation is loaded in a third, hidden iframe.
 */
function AlignmentView() {
  const { annotationId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeUserId = useWkSelector((state) => state.activeUser?.id);
  // Increased to mount the workspace anew, see AlignmentWorkspace's onRestart.
  const [workspaceRestartCount, setWorkspaceRestartCount] = useState(0);

  const annotationQuery = useApi({
    queryKey: ["alignDatasets", "annotation", annotationId],
    queryFn: () => getUnversionedAnnotationInformation(annotationId),
    refetchOnWindowFocus: false,
    // The workspace edits the name and description of the annotation, so it must not start
    // with a cached version when the page is opened again.
    gcTime: 0,
    meta: { persist: false },
  });
  const annotation = annotationQuery.data;
  const datasetQuery = useQuery({
    queryKey: ["alignDatasets", "dataset", annotation?.datasetId],
    queryFn: () => getDataset(annotation!.datasetId),
    enabled: annotation != null,
  });
  const dataset = datasetQuery.data;

  if (annotationQuery.isError) {
    return <AlignmentPageError text="Could not load this annotation." />;
  }
  if (annotation == null) {
    return <AlignmentPageSpinner />;
  }
  const { layerAlignment } = annotation;
  if (layerAlignment == null) {
    return <AlignmentPageError text="This annotation is not an alignment annotation." />;
  }
  const editBlocker = getAlignmentEditBlocker(annotation, activeUserId);
  if (editBlocker != null) {
    return (
      <EditBlockerNotice
        annotation={annotation}
        editBlocker={editBlocker}
        onAnnotationChanged={() => annotationQuery.refetch()}
      />
    );
  }
  if (datasetQuery.isError) {
    return <AlignmentPageError text="Could not load the dataset of this annotation." />;
  }
  if (dataset == null) {
    return <AlignmentPageSpinner />;
  }
  if (!dataset.isActive) {
    return (
      <AlignmentPageError text="This dataset is not active, so its layers cannot be aligned." />
    );
  }
  const { fixedLayerName } = layerAlignment;
  if (!dataset.dataSource.dataLayers.some((layer) => layer.name === fixedLayerName)) {
    return (
      <AlignmentPageError
        text={`The dataset has no layer named "${fixedLayerName}" anymore, so this alignment can't be opened.`}
      />
    );
  }
  const movingLayerNames = getMovingLayerNames(dataset, fixedLayerName);
  const movingLayerName = getActiveMovingLayerName(
    movingLayerNames,
    searchParams.get(MOVING_LAYER_URL_PARAM),
  );
  if (movingLayerName == null) {
    return (
      <AlignmentPageError text="The dataset has no other layer that could be aligned to the fixed layer." />
    );
  }
  const layerNames: LayerNames = { A: fixedLayerName, B: movingLayerName };
  return (
    <AlignmentWorkspace
      // A new moving layer needs fresh workers, see onSwitchMovingLayer.
      key={`${annotation.id}-${movingLayerName}-${workspaceRestartCount}`}
      dataset={dataset}
      layerNames={layerNames}
      movingLayerNames={movingLayerNames}
      onSwitchMovingLayer={(layerName) =>
        setSearchParams({ [MOVING_LAYER_URL_PARAM]: layerName }, { replace: true })
      }
      landmarkAnnotation={annotation}
      onRestart={async () => {
        // The workspace starts with the name and description of the loaded annotation, which
        // may have been edited since.
        await annotationQuery.refetch();
        setWorkspaceRestartCount((count) => count + 1);
      }}
    />
  );
}

function EditBlockerNotice({
  annotation,
  editBlocker,
  onAnnotationChanged,
}: {
  annotation: APIAnnotation;
  editBlocker: AlignmentEditBlocker;
  onAnnotationChanged: () => void;
}) {
  const navigate = useNavigate();

  const resolveEditBlocker = async () => {
    try {
      const annotationIdToOpen = await resolveAlignmentEditBlocker(annotation, editBlocker);
      if (annotationIdToOpen === annotation.id) {
        onAnnotationChanged();
      } else {
        navigate(
          getAlignmentViewUrl(
            { name: annotation.dataSetName, id: annotation.datasetId },
            annotationIdToOpen,
          ),
        );
      }
    } catch (error) {
      handleGenericError(error as Error);
    }
  };

  return (
    <Space orientation="vertical" style={{ margin: 40 }}>
      <Typography.Text>{getEditBlockerDescription(annotation, editBlocker)}</Typography.Text>
      <AsyncButton type="primary" onClick={resolveEditBlocker}>
        {EDIT_BLOCKER_ACTION_LABELS[editBlocker]}
      </AsyncButton>
    </Space>
  );
}

export default AlignmentView;
