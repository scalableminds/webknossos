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

    const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
    const highestResolutionIndex = datasetResolutionInfo.getHighestResolutionIndex();
    const lowestResolutionIndex = datasetResolutionInfo.getClosestExistingIndex(0);

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
      >
        With Existing Segmentation{" "}
        <Tooltip
          title="Base your volume annotation on an existing segmentation layer of this dataset. Note that skeleton-only annotations always show the existing segmentation."
          placement="right"
        >
          <InfoCircleOutlined />
        </Tooltip>
      </Checkbox>
    );

    const lowResolutionIndex = Math.max(lowestResolutionIndex, userDefinedResolutionIndices[0]);
    const highResolutionIndex = Math.min(highestResolutionIndex, userDefinedResolutionIndices[1]);

    modalContent = (
      <React.Fragment>
        <Radio.Group onChange={e => setAnnotationType(e.target.value)} value={annotationType}>
          <Radio value="hybrid">Skeleton and Volume</Radio>
          <Radio value="skeleton">Skeleton only</Radio>
          <Radio value="volume">Volume only</Radio>
        </Radio.Group>
        <br />
        <br />
        {fallbackCheckbox}
        <br />
        <br />
        <h5>
          Volume Resolutions{" "}
          <Tooltip
            title="Select which of the dataset resolutions the volume data should be created at. Resolution 1 is the most detailed, 4-4-2 is downsampled by factor 4 in x and y, and by factor 2 in z."
            placement="right"
          >
            <InfoCircleOutlined />
          </Tooltip>
        </h5>
        <div style={{ display: "inline-block", width: "5em", verticalAlign: "middle" }}>
          {datasetResolutionInfo.getResolutionByIndex(lowResolutionIndex).join("-")}
        </div>
        <div
          style={{
            display: "inline-block",
            width: "60%",
            verticalAlign: "middle",
            paddingRight: "1em",
          }}
        >
          <Slider
            tooltipVisible={false}
            onChange={value => setUserDefinedResolutionIndices(value)}
            range
            step={1}
            min={lowestResolutionIndex}
            max={highestResolutionIndex}
            value={[lowResolutionIndex, highResolutionIndex]}
          />
        </div>
        <div style={{ display: "inline-block", width: "5em", verticalAlign: "middle" }}>
          {datasetResolutionInfo.getResolutionByIndex(highResolutionIndex).join("-")}
        </div>
        <br />
        <br />
        <Link
          to={`/datasets/${dataset.owningOrganization}/${
            dataset.name
          }/createExplorative/${annotationType}/${isFallbackSegmentationSelectedString}?minRes=${Math.max(
            ...datasetResolutionInfo.getResolutionByIndex(lowResolutionIndex),
          )}&maxRes=${Math.max(
            ...datasetResolutionInfo.getResolutionByIndex(highResolutionIndex),
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
      title={`Create New Annotation for dataset “${dataset.name}”`}
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
