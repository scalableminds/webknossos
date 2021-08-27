// @flow
import { Modal, Radio, Button, Tooltip, Slider, Spin } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import type { APIDatasetId } from "types/api_flow_types";
import { Link } from "react-router-dom";
import { useFetch } from "libs/react_helpers";
import { getDataset } from "admin/admin_rest_api";

import {
  doesSupportVolumeWithFallback,
  getDatasetResolutionInfo,
  getSegmentationLayers,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";

type Props = {
  datasetId: APIDatasetId,
  onClose: () => void,
};

const CreateExplorativeModal = ({ datasetId, onClose }: Props) => {
  const dataset = useFetch(() => getDataset(datasetId), null, [datasetId]);
  const [annotationType, setAnnotationType] = useState("hybrid");
  const [userDefinedResolutionIndices, setUserDefinedResolutionIndices] = useState([0, 10000]);
  const [selectedSegmentationLayerIndex, setSelectedSegmentationLayerIndex] = useState(null);

  let modalContent = <Spin />;

  if (dataset !== null) {
    const segmentationLayers = getSegmentationLayers(dataset);
    const selectedSegmentationLayer =
      segmentationLayers.length > 0 && selectedSegmentationLayerIndex != null
        ? segmentationLayers[selectedSegmentationLayerIndex]
        : null;

    const fallbackLayerGetParameter =
      selectedSegmentationLayer != null ? `fallbackLayer=${selectedSegmentationLayer.name}` : "";

    const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
    let highestResolutionIndex = datasetResolutionInfo.getHighestResolutionIndex();
    let lowestResolutionIndex = datasetResolutionInfo.getClosestExistingIndex(0);

    if (annotationType !== "skeleton" && selectedSegmentationLayer != null) {
      const datasetFallbackLayerResolutionInfo = getResolutionInfo(
        selectedSegmentationLayer.resolutions,
      );
      highestResolutionIndex = datasetFallbackLayerResolutionInfo.getHighestResolutionIndex();
      lowestResolutionIndex = datasetFallbackLayerResolutionInfo.getClosestExistingIndex(0);
    }

    const highResolutionIndex = Math.min(highestResolutionIndex, userDefinedResolutionIndices[1]);
    const lowResolutionIndex = Math.max(lowestResolutionIndex, userDefinedResolutionIndices[0]);

    const resolutionSlider =
      annotationType !== "skeleton" ? (
        <React.Fragment>
          <h5 style={{ marginBottom: 0 }}>
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
            <div style={{ width: "5em" }}>
              {datasetResolutionInfo.getResolutionByIndexOrThrow(lowResolutionIndex).join("-")}
            </div>
            <Slider
              tooltipVisible={false}
              onChange={value => setUserDefinedResolutionIndices(value)}
              range
              disabled={annotationType === "skeleton"}
              step={1}
              min={lowestResolutionIndex}
              max={highestResolutionIndex}
              value={[lowResolutionIndex, highResolutionIndex]}
              style={{ flexGrow: 1 }}
            />
            <div style={{ width: "6.5em", textAlign: "right" }}>
              {datasetResolutionInfo.getResolutionByIndexOrThrow(highResolutionIndex).join("-")}
            </div>
          </div>
        </React.Fragment>
      ) : null;

    modalContent = (
      <React.Fragment>
        <div style={{ marginBottom: 16 }}>
          <Radio.Group onChange={e => setAnnotationType(e.target.value)} value={annotationType}>
            <Radio value="hybrid">Skeleton and Volume</Radio>
            <Radio value="skeleton">Skeleton only</Radio>
            <Radio value="volume">Volume only</Radio>
          </Radio.Group>
        </div>

        {annotationType !== "skeleton" && segmentationLayers.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            Base Volume Annotation On{" "}
            <Tooltip
              title="Base your volume annotation on an existing segmentation layer of this dataset or create a new (empty) layer for the annotation."
              placement="right"
            >
              <InfoCircleOutlined />
            </Tooltip>
            <Radio.Group
              onChange={e => {
                const index = parseInt(e.target.value);
                setSelectedSegmentationLayerIndex(index !== -1 ? index : null);
              }}
              value={selectedSegmentationLayerIndex != null ? selectedSegmentationLayerIndex : -1}
            >
              <Radio key={-1} value={-1}>
                Create empty layer
              </Radio>
              {segmentationLayers.map((segmentationLayer, index) => (
                <Radio
                  key={segmentationLayer.name}
                  value={index}
                  disabled={!doesSupportVolumeWithFallback(dataset, segmentationLayer)}
                >
                  {segmentationLayer.name}
                </Radio>
              ))}
            </Radio.Group>
          </div>
        ) : null}

        {lowestResolutionIndex < highestResolutionIndex ? resolutionSlider : null}
        <div style={{ textAlign: "right" }}>
          <Link
            to={`/datasets/${dataset.owningOrganization}/${
              dataset.name
            }/createExplorative/${annotationType}/?${fallbackLayerGetParameter}&minRes=${Math.max(
              ...datasetResolutionInfo.getResolutionByIndexOrThrow(lowResolutionIndex),
            )}&maxRes=${Math.max(
              ...datasetResolutionInfo.getResolutionByIndexOrThrow(highResolutionIndex),
            )}`}
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
      visible
      width={500}
      footer={null}
      onCancel={onClose}
    >
      {modalContent}
    </Modal>
  );
};

export default CreateExplorativeModal;
