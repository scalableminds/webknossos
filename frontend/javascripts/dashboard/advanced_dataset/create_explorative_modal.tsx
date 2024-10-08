import { InfoCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Modal, Radio, Button, Tooltip, Slider, Spin } from "antd";
import React, { useEffect, useState } from "react";
import type { APIDataset, APIDatasetId, APISegmentationLayer } from "types/api_flow_types";
import {
  doesSupportVolumeWithFallback,
  getSomeMagnificationInfoForDataset,
  getSegmentationLayers,
  getMagnificationInfo,
  getSegmentationLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import { getDataset } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import type { MagnificationInfo } from "oxalis/model/helpers/resolution_info";

type Props = {
  datasetId: APIDatasetId;
  onClose: () => void;
};
type RestrictMagnificationSliderProps = {
  magnificationInfo: MagnificationInfo;
  selectedSegmentationLayer: APISegmentationLayer | null;
  magIndices: number[];
  setMagIndices: (userIndices: number[]) => void;
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

export function RestrictMagnificationSlider({
  magnificationInfo,
  selectedSegmentationLayer,
  magIndices,
  setMagIndices,
}: RestrictMagnificationSliderProps) {
  let highestMagIndex = magnificationInfo.getCoarsestMagIndex();
  let lowestMagIndex = magnificationInfo.getFinestMagIndex();

  if (selectedSegmentationLayer != null) {
    const datasetFallbackLayerMagnificationInfo = getMagnificationInfo(
      selectedSegmentationLayer.resolutions,
    );
    highestMagIndex = datasetFallbackLayerMagnificationInfo.getCoarsestMagIndex();
    lowestMagIndex = datasetFallbackLayerMagnificationInfo.getFinestMagIndex();
  }

  const highMagnificationIndex = Math.min(highestMagIndex, magIndices[1]);
  const lowMagnificationIndex = Math.max(lowestMagIndex, magIndices[0]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setMagIndices should also be added to the dependencies. Consider fixing this.
  useEffect(() => {
    setMagIndices([lowestMagIndex, highestMagIndex]);
  }, [lowestMagIndex, highestMagIndex]);

  return lowestMagIndex < highestMagIndex ? (
    <React.Fragment>
      <h5
        style={{
          marginBottom: 0,
        }}
      >
        Restrict Volume Magnifications{" "}
        <Tooltip
          title="Select which of the dataset magnifications the volume data should be created at. Restricting the available mags can greatly improve the performance when annotating large structures, such as nuclei, since the volume data does not need to be stored in all quality levels. How to read: Mag 1 is the most detailed, 4-4-2 is downsampled by factor 4 in x and y, and by factor 2 in z."
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
          {magnificationInfo.getMagByIndexOrThrow(lowMagnificationIndex).join("-")}
        </div>
        <Slider
          tooltip={{ open: false }}
          onChange={(value) => setMagIndices(value)}
          range
          step={1}
          min={lowestMagIndex}
          max={highestMagIndex}
          value={[lowMagnificationIndex, highMagnificationIndex]}
          style={{
            flexGrow: 1,
          }}
        />
        <div
          style={{
            marginLeft: 20,
            textAlign: "right",
          }}
        >
          {magnificationInfo.getMagByIndexOrThrow(highMagnificationIndex).join("-")}
        </div>
      </div>
    </React.Fragment>
  ) : null;
}

function CreateExplorativeModal({ datasetId, onClose }: Props) {
  const dataset = useFetch(() => getDataset(datasetId), null, [datasetId]);
  const [annotationType, setAnnotationType] = useState("hybrid");
  const [userDefinedMagIndices, setUserDefinedMagIndices] = useState([0, 10000]);
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
    const magnificationInfo =
      selectedSegmentationLayer == null
        ? getSomeMagnificationInfoForDataset(dataset)
        : getMagnificationInfo(selectedSegmentationLayer.resolutions);
    const highestMagIndex = magnificationInfo.getCoarsestMagIndex();
    const lowestMagIndex = magnificationInfo.getFinestMagIndex();

    const highMagIndex = Math.min(highestMagIndex, userDefinedMagIndices[1]);
    const lowMagIndex = Math.max(lowestMagIndex, userDefinedMagIndices[0]);
    const magSlider =
      annotationType !== "skeleton" ? (
        <RestrictMagnificationSlider
          magnificationInfo={magnificationInfo}
          selectedSegmentationLayer={selectedSegmentationLayer}
          magIndices={userDefinedMagIndices}
          setMagIndices={setUserDefinedMagIndices}
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

        {magSlider}
        <div
          style={{
            textAlign: "right",
          }}
        >
          <Link
            to={`/datasets/${dataset.owningOrganization}/${
              dataset.name
            }/createExplorative/${annotationType}/?minRes=${Math.max(
              ...magnificationInfo.getMagByIndexOrThrow(lowMagIndex),
            )}&maxRes=${Math.max(
              ...magnificationInfo.getMagByIndexOrThrow(highMagIndex),
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
