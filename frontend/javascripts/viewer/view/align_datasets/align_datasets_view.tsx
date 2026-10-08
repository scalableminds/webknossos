import { useQuery } from "@tanstack/react-query";
import { getDataset } from "admin/rest_api";
import { Spin, Typography } from "antd";
import { useParams, useSearchParams } from "react-router";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { findOrCreateLandmarkAnnotationId } from "./alignment_helpers";
import { AlignmentWorkspace } from "./alignment_workspace";
import { LayerPairPicker } from "./layer_pair_picker";

// Page for aligning one layer of a dataset ("moving" layer) to another ("fixed" layer) by
// placing matching landmarks in both, similar to the BigWarp plugin of Fiji.
// The page shows the two layers side by side, each in an iframe with a sandbox annotation
// view ("worker", see bigwarp_worker.ts). The landmarks are stored in a separate skeleton
// annotation, which is loaded in a third, hidden iframe.
function AlignDatasetsView() {
  const { datasetNameAndId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixedLayerName = searchParams.get("layerA");
  const movingLayerName = searchParams.get("layerB");
  const { datasetId } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);

  const datasetQuery = useQuery({
    queryKey: ["alignDatasets", "dataset", datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: datasetId != null,
  });
  const landmarkAnnotationQuery = useQuery({
    queryKey: ["alignDatasets", "landmarkAnnotationId", datasetId, fixedLayerName, movingLayerName],
    queryFn: () =>
      findOrCreateLandmarkAnnotationId(datasetId!, { A: fixedLayerName!, B: movingLayerName! }),
    enabled: datasetId != null && fixedLayerName != null && movingLayerName != null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    meta: { persist: false },
  });
  const dataset = datasetQuery.data;

  if (datasetId == null) {
    return (
      <ErrorMessage text="This page needs a dataset id in the URL. Please open it via the dataset actions menu." />
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
  if (fixedLayerName == null || movingLayerName == null) {
    return (
      <LayerPairPicker
        dataset={dataset}
        onPick={(layerA, layerB) => setSearchParams({ layerA, layerB })}
      />
    );
  }
  if (landmarkAnnotationQuery.isError) {
    return <ErrorMessage text="Could not create the landmark annotation for this layer pair." />;
  }
  if (landmarkAnnotationQuery.data == null) {
    return <Spin style={{ margin: 40 }} description="Preparing the landmark annotation..." />;
  }
  return (
    <AlignmentWorkspace
      // A new layer pair needs fresh iframes and sync state.
      key={`${fixedLayerName}:${movingLayerName}`}
      dataset={dataset}
      fixedLayerName={fixedLayerName}
      movingLayerName={movingLayerName}
      landmarkAnnotationId={landmarkAnnotationQuery.data}
    />
  );
}

function ErrorMessage({ text }: { text: string }) {
  return (
    <Typography.Text type="danger" style={{ display: "block", margin: 40 }}>
      {text}
    </Typography.Text>
  );
}

export default AlignDatasetsView;
