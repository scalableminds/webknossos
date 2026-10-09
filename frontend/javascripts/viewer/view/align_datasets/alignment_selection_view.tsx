import { useQuery } from "@tanstack/react-query";
import { createLayerAlignment, getDataset } from "admin/rest_api";
import { Spin } from "antd";
import { handleGenericError } from "libs/error_handling";
import { useNavigate, useParams } from "react-router";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { ErrorMessage } from "./alignment_view";
import { getAlignmentViewUrl } from "./bigwarp_protocol";
import { LayerPairPicker } from "./layer_pair_picker";

// Creates a new alignment annotation for a layer pair of the dataset and opens it.
function AlignmentSelectionView() {
  const { datasetNameAndId = "" } = useParams();
  const navigate = useNavigate();
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

  const createAlignment = async (fixedLayerName: string, movingLayerName: string) => {
    try {
      const annotation = await createLayerAlignment(dataset.id, {
        fixedLayerName,
        movingLayerName,
      });
      navigate(getAlignmentViewUrl(dataset, annotation.id));
    } catch (error) {
      handleGenericError(error as Error, "Could not create the alignment annotation.");
    }
  };

  return <LayerPairPicker dataset={dataset} onPick={createAlignment} />;
}

export default AlignmentSelectionView;
