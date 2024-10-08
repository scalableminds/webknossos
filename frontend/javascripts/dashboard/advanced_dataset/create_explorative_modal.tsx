import { InfoCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Modal, Radio, Button, Tooltip, Spin } from "antd";
import React, { useEffect, useState } from "react";
import type { APIDataset, APIDatasetId, APISegmentationLayer } from "types/api_flow_types";
import {
  doesSupportVolumeWithFallback,
  getSomeResolutionInfoForDataset,
  getSegmentationLayers,
  getResolutionInfo,
  getSegmentationLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import { getDataset } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import type { ResolutionInfo } from "oxalis/model/helpers/resolution_info";
import { Slider } from "components/slider";

type Props = {
  datasetId: APIDatasetId;
  onClose: () => void;
};
type RestrictResolutionSliderProps = {
  resolutionInfo: ResolutionInfo;
  selectedSegmentationLayer: APISegmentationLayer | null;
  resolutionIndices: number[];
  setResolutionIndices: (userIndices: number[]) => void;
};
export function NewVolumeLayerSelection({
  segmentationLayers,
  dataset,
  selectedSegmentationLayerName,
  setSelectedSegmentationLayerName,
  disableLayerSelection,
}: {
  segmentationLayers: Array<APISegmentationLayer>;
  dataset: APIDataset;
  selectedSegmentationLayerName: string | undefined;
  setSelectedSegmentationLayerName: (arg0: string | undefined) => void;
  disableLayerSelection?: boolean | undefined;
}) {
  const selectedSegmentationLayerIndex =
    selectedSegmentationLayerName != null
      ? segmentationLayers.indexOf(
          getSegmentationLayerByName(dataset, selectedSegmentationLayerName),
        )
      : -1;
  return (
    <div
      style={{
        marginBottom: 16,
      }}
    >
      Base Volume Annotation On{" "}
      <Tooltip
        title="Base your volume annotation on an existing segmentation layer of this dataset or create a new (empty) layer for the annotation."
        placement="right"
      >
        <InfoCircleOutlined />
      </Tooltip>
      <Radio.Group
        onChange={(e) => {
          const index = Number.parseInt(e.target.value);
          setSelectedSegmentationLayerName(
            index !== -1 ? segmentationLayers[index].name : undefined,
          );
        }}
        value={selectedSegmentationLayerIndex}
        disabled={disableLayerSelection ?? false}
      >
        {segmentationLayers.map((segmentationLayer, index) => (
          <Radio
            key={segmentationLayer.name}
            value={index}
            disabled={!doesSupportVolumeWithFallback(dataset, segmentationLayer)}
          >
            “{segmentationLayer.name}” layer
          </Radio>
        ))}
        <Radio key={-1} value={-1}>
          Create empty layer
        </Radio>
      </Radio.Group>
    </div>
  );
}

export function RestrictResolutionSlider({
  resolutionInfo,
  selectedSegmentationLayer,
  resolutionIndices,
  setResolutionIndices,
}: RestrictResolutionSliderProps) {
  let highestResolutionIndex = resolutionInfo.getCoarsestResolutionIndex();
  let lowestResolutionIndex = resolutionInfo.getFinestResolutionIndex();

  if (selectedSegmentationLayer != null) {
    const datasetFallbackLayerResolutionInfo = getResolutionInfo(
      selectedSegmentationLayer.resolutions,
    );
    highestResolutionIndex = datasetFallbackLayerResolutionInfo.getCoarsestResolutionIndex();
    lowestResolutionIndex = datasetFallbackLayerResolutionInfo.getFinestResolutionIndex();
  }

  const highResolutionIndex = Math.min(highestResolutionIndex, resolutionIndices[1]);
  const lowResolutionIndex = Math.max(lowestResolutionIndex, resolutionIndices[0]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setResolutionIndices should also be added to the dependencies. Consider fixing this.
  useEffect(() => {
    setResolutionIndices([lowestResolutionIndex, highestResolutionIndex]);
  }, [lowestResolutionIndex, highestResolutionIndex]);

  return lowestResolutionIndex < highestResolutionIndex ? (
    <React.Fragment>
      <h5
        style={{
          marginBottom: 0,
        }}
      >
        Restrict Volume Resolutions{" "}
        <Tooltip
          title="Select which of the dataset resolutions the volume data should be created at. Restricting the available resolutions can greatly improve the performance when annotating large structures, such as nuclei, since the volume data does not need to be stored in all quality levels. How to read: Resolution 1 is the most detailed, 4-4-2 is downsampled by factor 4 in x and y, and by factor 2 in z."
          placement="right"
        >
          <InfoCircleOutlined />
        </Tooltip>
      </h5>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          alignContent: "center",
        }}
      >
        <div
          style={{
            marginRight: 20,
          }}
        >
          {resolutionInfo.getResolutionByIndexOrThrow(lowResolutionIndex).join("-")}
        </div>
        <Slider
          tooltip={{ open: false }}
          onChange={(value) => setResolutionIndices(value)}
          range
          step={1}
          min={lowestResolutionIndex}
          max={highestResolutionIndex}
          value={[lowResolutionIndex, highResolutionIndex]}
          style={{
            flexGrow: 1,
          }}
          onWheelDisabled
        />
        <div
          style={{
            marginLeft: 20,
            textAlign: "right",
          }}
        >
          {resolutionInfo.getResolutionByIndexOrThrow(highResolutionIndex).join("-")}
        </div>
      </div>
    </React.Fragment>
  ) : null;
}

function CreateExplorativeModal({ datasetId, onClose }: Props) {
  const dataset = useFetch(() => getDataset(datasetId), null, [datasetId]);
  const [annotationType, setAnnotationType] = useState("hybrid");
  const [userDefinedResolutionIndices, setUserDefinedResolutionIndices] = useState([0, 10000]);
  const [selectedSegmentationLayerName, setSelectedSegmentationLayerName] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    if (dataset !== null) {
      const segmentationLayers = getSegmentationLayers(dataset);
      if (segmentationLayers.length > 0)
        setSelectedSegmentationLayerName(segmentationLayers[0].name);
    }
  }, [dataset]);

  let modalContent = <Spin />;

  if (dataset !== null) {
    const segmentationLayers = getSegmentationLayers(dataset);
    const selectedSegmentationLayer =
      annotationType !== "skeleton" &&
      segmentationLayers.length > 0 &&
      selectedSegmentationLayerName != null
        ? getSegmentationLayerByName(dataset, selectedSegmentationLayerName)
        : null;
    const fallbackLayerGetParameter =
      selectedSegmentationLayer != null
        ? `&fallbackLayerName=${selectedSegmentationLayer.name}`
        : "";
    const resolutionInfo =
      selectedSegmentationLayer == null
        ? getSomeResolutionInfoForDataset(dataset)
        : getResolutionInfo(selectedSegmentationLayer.resolutions);
    const highestResolutionIndex = resolutionInfo.getCoarsestResolutionIndex();
    const lowestResolutionIndex = resolutionInfo.getFinestResolutionIndex();

    const highResolutionIndex = Math.min(highestResolutionIndex, userDefinedResolutionIndices[1]);
    const lowResolutionIndex = Math.max(lowestResolutionIndex, userDefinedResolutionIndices[0]);
    const resolutionSlider =
      annotationType !== "skeleton" ? (
        <RestrictResolutionSlider
          resolutionInfo={resolutionInfo}
          selectedSegmentationLayer={selectedSegmentationLayer}
          resolutionIndices={userDefinedResolutionIndices}
          setResolutionIndices={setUserDefinedResolutionIndices}
        />
      ) : null;
    modalContent = (
      <React.Fragment>
        <div
          style={{
            marginBottom: 16,
          }}
        >
          <Radio.Group onChange={(e) => setAnnotationType(e.target.value)} value={annotationType}>
            <Radio value="hybrid">Skeleton and Volume</Radio>
            <Radio value="skeleton">Skeleton only</Radio>
            <Radio value="volume">Volume only</Radio>
          </Radio.Group>
        </div>

        {annotationType !== "skeleton" && segmentationLayers.length > 0 ? (
          <NewVolumeLayerSelection
            segmentationLayers={segmentationLayers}
            dataset={dataset}
            selectedSegmentationLayerName={selectedSegmentationLayerName}
            setSelectedSegmentationLayerName={setSelectedSegmentationLayerName}
          />
        ) : null}

        {resolutionSlider}
        <div
          style={{
            textAlign: "right",
          }}
        >
          <Link
            to={`/datasets/${dataset.owningOrganization}/${
              dataset.name
            }/createExplorative/${annotationType}/?minRes=${Math.max(
              ...resolutionInfo.getResolutionByIndexOrThrow(lowResolutionIndex),
            )}&maxRes=${Math.max(
              ...resolutionInfo.getResolutionByIndexOrThrow(highResolutionIndex),
            )}${fallbackLayerGetParameter}`}
            title="Create new annotation with selected properties"
          >
            <Button size="large" type="primary">
              Create Annotation
            </Button>
          </Link>
        </div>
      </React.Fragment>
    );
  }

  return (
    <Modal
      title={`Create New Annotation for Dataset “${datasetId.name}”`}
      open
      width={500}
      footer={null}
      onCancel={onClose}
    >
      {modalContent}
    </Modal>
  );
}

export default CreateExplorativeModal;
