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
  EDIT_BLOCKER_ACTION_LABELS,
  getEditBlockerDescription,
  getLayerRegistrationEditBlocker,
  type LayerRegistrationEditBlocker,
  resolveLayerRegistrationEditBlocker,
} from "./layer_registration_edit_blocker";
import type { LayerNames } from "./layer_registration_helpers";
import { getActiveMovingLayerName, getMovingLayerNames } from "./layer_registration_moving_layers";
import {
  LayerRegistrationPageError,
  LayerRegistrationPageSpinner,
} from "./layer_registration_page_status_views";
import { getLayerRegistrationViewUrl, MOVING_LAYER_URL_PARAM } from "./layer_registration_protocol";
import { LayerRegistrationWorkspace } from "./layer_registration_workspace";

/**  Registers the layers of a dataset ("moving" layers) to one of its layers ("fixed" layer)
 * by placing matching landmarks in both, similar to the BigWarp plugin of Fiji. The landmarks are
 * stored in a layer registration annotation, which belongs to the fixed layer and holds the
 * landmarks of all moving layers. The page shows the fixed layer and one moving layer side by side,
 * each in an iframe with a sandbox annotation view ("worker", see layer_registration_worker.ts).
 * The moving layer is chosen with a URL param. The layer registration annotation is loaded in a
 * third, hidden iframe.
 */
function LayerRegistrationView() {
  const { annotationId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeUserId = useWkSelector((state) => state.activeUser?.id);
  // Increased to mount the workspace anew, see LayerRegistrationWorkspace's onRestart.
  const [workspaceRestartCount, setWorkspaceRestartCount] = useState(0);

  const annotationQuery = useApi({
    queryKey: ["layerRegistration", "annotation", annotationId],
    queryFn: () => getUnversionedAnnotationInformation(annotationId),
    refetchOnWindowFocus: false,
    // The workspace edits the name and description of the annotation, so it must not start
    // with a cached version when the page is opened again.
    gcTime: 0,
    meta: { persist: false },
  });
  const annotation = annotationQuery.data;
  const datasetQuery = useQuery({
    queryKey: ["layerRegistration", "dataset", annotation?.datasetId],
    queryFn: () => getDataset(annotation!.datasetId),
    enabled: annotation != null,
  });
  const dataset = datasetQuery.data;

  if (annotationQuery.isError) {
    return <LayerRegistrationPageError text="Could not load this annotation." />;
  }
  if (annotation == null) {
    return <LayerRegistrationPageSpinner />;
  }
  const { layerRegistration } = annotation;
  if (layerRegistration == null) {
    return (
      <LayerRegistrationPageError text="This annotation is not a layer registration annotation." />
    );
  }
  const editBlocker = getLayerRegistrationEditBlocker(annotation, activeUserId);
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
    return <LayerRegistrationPageError text="Could not load the dataset of this annotation." />;
  }
  if (dataset == null) {
    return <LayerRegistrationPageSpinner />;
  }
  if (!dataset.isActive) {
    return (
      <LayerRegistrationPageError text="This dataset is not active, so its layers cannot be registered." />
    );
  }
  const { fixedLayerName } = layerRegistration;
  if (!dataset.dataSource.dataLayers.some((layer) => layer.name === fixedLayerName)) {
    return (
      <LayerRegistrationPageError
        text={`The dataset has no layer named "${fixedLayerName}" anymore, so this layer registration can't be opened.`}
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
      <LayerRegistrationPageError text="The dataset has no other layer that could be registered to the fixed layer." />
    );
  }
  const layerNames: LayerNames = { fixed: fixedLayerName, moving: movingLayerName };
  return (
    <LayerRegistrationWorkspace
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
  editBlocker: LayerRegistrationEditBlocker;
  onAnnotationChanged: () => void;
}) {
  const navigate = useNavigate();

  const resolveEditBlocker = async () => {
    try {
      const annotationIdToOpen = await resolveLayerRegistrationEditBlocker(annotation, editBlocker);
      if (annotationIdToOpen === annotation.id) {
        onAnnotationChanged();
      } else {
        navigate(
          getLayerRegistrationViewUrl(
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

export default LayerRegistrationView;
