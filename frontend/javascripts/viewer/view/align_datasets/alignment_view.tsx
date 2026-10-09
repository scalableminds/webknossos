import { useQuery } from "@tanstack/react-query";
import { getDataset, getUnversionedAnnotationInformation } from "admin/rest_api";
import { Space, Spin, Typography } from "antd";
import { AsyncButton } from "components/async_clickables";
import { handleGenericError } from "libs/error_handling";
import { useApi, useWkSelector } from "libs/react_hooks";
import { useNavigate, useParams } from "react-router";
import type { APIAnnotation } from "types/api_types";
import {
  EDIT_BLOCKER_ACTION_LABELS,
  getMissingLayerNames,
  resolveAlignmentEditBlocker,
} from "./alignment_helpers";
import { AlignmentWorkspace } from "./alignment_workspace";
import {
  type AlignmentEditBlocker,
  getAlignmentEditBlocker,
  getAlignmentViewUrl,
} from "./bigwarp_protocol";

/**  Aligns one layer of a dataset ("moving" layer) to another ("fixed" layer) by placing
 * matching landmarks in both, similar to the BigWarp plugin of Fiji. The landmarks are stored
 * in an alignment annotation, which belongs to one layer pair.
 * The page shows the two layers side by side, each in an iframe with a sandbox annotation
 * view ("worker", see bigwarp_worker.ts). The alignment annotation is loaded in a third,
 * hidden iframe.
 */
function AlignmentView() {
  const { annotationId = "" } = useParams();
  const activeUserId = useWkSelector((state) => state.activeUser?.id);

  const annotationQuery = useApi({
    queryKey: ["alignDatasets", "annotation", annotationId],
    queryFn: () => getUnversionedAnnotationInformation(annotationId),
    refetchOnWindowFocus: false,
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
    return <ErrorMessage text="Could not load this annotation." />;
  }
  if (annotation == null) {
    return <Spin style={{ margin: 40 }} />;
  }
  const { layerAlignment } = annotation;
  if (layerAlignment == null) {
    return <ErrorMessage text="This annotation is not an alignment annotation." />;
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
    return <ErrorMessage text="Could not load the dataset of this annotation." />;
  }
  if (dataset == null) {
    return <Spin style={{ margin: 40 }} />;
  }
  if (!dataset.isActive) {
    return <ErrorMessage text="This dataset is not active, so its layers cannot be aligned." />;
  }
  const layerNames = { A: layerAlignment.fixedLayerName, B: layerAlignment.movingLayerName };
  const missingLayerNames = getMissingLayerNames(dataset, layerNames);
  if (missingLayerNames.length > 0) {
    return (
      <ErrorMessage
        text={`The dataset has no layer named ${missingLayerNames.map((name) => `"${name}"`).join(" or ")} anymore, so this alignment can't be opened.`}
      />
    );
  }
  return (
    <AlignmentWorkspace
      key={annotation.id}
      dataset={dataset}
      fixedLayerName={layerNames.A}
      movingLayerName={layerNames.B}
      landmarkAnnotationId={annotation.id}
    />
  );
}

const EDIT_BLOCKER_DESCRIPTIONS: Record<
  AlignmentEditBlocker,
  (annotation: APIAnnotation) => string
> = {
  notOwner: (annotation) =>
    `This alignment belongs to ${annotation.owner != null ? `${annotation.owner.firstName} ${annotation.owner.lastName}` : "another user"}. Copy it to your account to work on it.`,
  archived: () => "This alignment is archived. Unarchive it to work on it.",
  locked: () => "This alignment is locked. Unlock it to work on it.",
};

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
      <Typography.Text>{EDIT_BLOCKER_DESCRIPTIONS[editBlocker](annotation)}</Typography.Text>
      <AsyncButton type="primary" onClick={resolveEditBlocker}>
        {EDIT_BLOCKER_ACTION_LABELS[editBlocker]}
      </AsyncButton>
    </Space>
  );
}

export function ErrorMessage({ text }: { text: string }) {
  return (
    <Typography.Text type="danger" style={{ display: "block", margin: 40 }}>
      {text}
    </Typography.Text>
  );
}

export default AlignmentView;
