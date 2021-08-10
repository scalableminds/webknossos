// @flow
import { Modal, Radio, Button, Checkbox, Tooltip, Slider, Spin } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import type { APIDatasetId } from "types/api_flow_types";
import { Link } from "react-router-dom";
import { useFetch } from "libs/react_helpers";
import { getDataset } from "admin/admin_rest_api";

import {
  getSegmentationLayer,
  doesSupportVolumeWithFallback,
  getDatasetResolutionInfo,
  getResolutionInfoOfSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";

type Props = {
  datasetId: APIDatasetId,
  onClose: () => void,
};

const CreateExplorativeModal = ({ datasetId, onClose }: Props) => {
  const dataset = useFetch(() => getDataset(datasetId), null, [datasetId]);
  const [annotationType, setAnnotationType] = useState("hybrid");
  const [userDefinedWithFallback, setUserDefinedWithFallback] = useState(true);
  const [userDefinedResolutionIndices, setUserDefinedResolutionIndices] = useState([0, 10000]);

  let modalContent = <Spin />;

  if (dataset !== null) {
    const segmentationLayer = getSegmentationLayer(dataset);

    const isFallbackSegmentationAlwaysOff =
      segmentationLayer == null ||
      (!doesSupportVolumeWithFallback(dataset) && annotationType !== "skeleton");
    const isFallbackSegmentationAlwaysOn =
      !isFallbackSegmentationAlwaysOff && annotationType === "skeleton";

    const isFallbackSegmentationOptional =
      !isFallbackSegmentationAlwaysOff && !isFallbackSegmentationAlwaysOn;

    const isFallbackSegmentationSelected =
      isFallbackSegmentationAlwaysOn ||
      (userDefinedWithFallback && !isFallbackSegmentationAlwaysOff);

    const isFallbackSegmentationSelectedString = isFallbackSegmentationSelected ? "true" : "false";

    const fallbackCheckbox = (
      <Checkbox
        onChange={e => setUserDefinedWithFallback(e.target.checked)}
        checked={isFallbackSegmentationSelected}
        disabled={!isFallbackSegmentationOptional}
        style={{ marginBottom: 16 }}
      >
        With Existing Segmentation{" "}
        <Tooltip
          title="Base your volume annotation on an existing segmentation layer of this dataset. Note that skeleton-only annotations always show the existing segmentation by default."
          placement="right"
        >
          <InfoCircleOutlined />
        </Tooltip>
      </Checkbox>
    );

    const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
    let highestResolutionIndex = datasetResolutionInfo.getHighestResolutionIndex();
    let lowestResolutionIndex = datasetResolutionInfo.getClosestExistingIndex(0);

    if (isFallbackSegmentationSelected && annotationType !== "skeleton") {
      const datasetFallbackLayerResolutionInfo = getResolutionInfoOfSegmentationLayer(dataset);
      highestResolutionIndex = datasetFallbackLayerResolutionInfo.getHighestResolutionIndex();
      lowestResolutionIndex = datasetFallbackLayerResolutionInfo.getClosestExistingIndex(0);
    }

    const highResolutionIndex = Math.min(highestResolutionIndex, userDefinedResolutionIndices[1]);
    const lowResolutionIndex = Math.max(lowestResolutionIndex, userDefinedResolutionIndices[0]);

    modalContent = (
      <React.Fragment>
        <div style={{ marginBottom: 16 }}>
          <Radio.Group onChange={e => setAnnotationType(e.target.value)} value={annotationType}>
            <Radio value="hybrid">Skeleton and Volume</Radio>
            <Radio value="skeleton">Skeleton only</Radio>
            <Radio value="volume">Volume only</Radio>
          </Radio.Group>
        </div>
        {doesSupportVolumeWithFallback(dataset) ? fallbackCheckbox : null}
        <h5 style={{ marginBottom: 0 }}>
          Volume Resolutions{" "}
          <Tooltip
            title="Select which of the dataset resolutions the volume data should be created at. For example, resolution 1 is the most detailed, 4-4-2 is downsampled by factor 4 in x and y, and by factor 2 in z."
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
          <div style={{ width: "5.5em", textAlign: "right" }}>
            {datasetResolutionInfo.getResolutionByIndexOrThrow(highResolutionIndex).join("-")}
          </div>
        </div>
        <Link
          to={`/datasets/${dataset.owningOrganization}/${
            dataset.name
          }/createExplorative/${annotationType}/${isFallbackSegmentationSelectedString}?minRes=${Math.max(
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
