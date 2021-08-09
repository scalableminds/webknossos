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

/*
const getNewTracingMenu = (maybeUnimportedDataset: APIMaybeUnimportedDataset) => {
  if (!maybeUnimportedDataset.isActive) {
    // The dataset isn't imported. This menu won't be shown, anyway.
    return <Menu />;
  }
  const dataset: APIDataset = maybeUnimportedDataset;

  const buildMenuItem = (type, useFallback, label, disabled = false) => {
    const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
    const minRes = 2;
    const maxRes = 4;
    let resolutionParameters = "";
    if (minRes != null) {
      resolutionParameters += `?minRes=${minRes}`;
    }
    if (maxRes != null) {
      resolutionParameters += minRes == null ? "?" : "&";
      resolutionParameters += `maxRes=${maxRes}`;
    }
    return (
      <Menu.Item key="existing">
        <LinkWithDisabled
          to={`/datasets/${dataset.owningOrganization}/${dataset.name}/createExplorative/${type}/${
            useFallback ? "true" : "false"
          }${resolutionParameters}`}
          title={`New ${typeCapitalized} Annotation`}
          disabled={disabled}
        >
          {label}
        </LinkWithDisabled>
      </Menu.Item>
    );
  };

  const segmentationLayer = getSegmentationLayer(dataset);

  if (segmentationLayer != null) {
    if (doesSupportVolumeWithFallback(dataset)) {
      return (
        <Menu>
          <Menu.ItemGroup title="Other Options:" />
          {buildMenuItem("hybrid", false, "New Annotation (Without Existing Segmentation)")}
          {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
          <Menu.SubMenu title="New Volume-only Annotation">
            {buildMenuItem("volume", true, "With Existing Segmentation")}
            {buildMenuItem("volume", false, "Without Existing Segmentation")}
          </Menu.SubMenu>
        </Menu>
      );
    } else {
      return (
        <Menu>
          <Menu.ItemGroup title="Other Options:" />
          {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
          <Menu.SubMenu title="New Volume-only Annotation">
            {buildMenuItem("volume", true, "With existing Segmentation", true)}
            {buildMenuItem("volume", false, "Without Existing Segmentation")}
          </Menu.SubMenu>
        </Menu>
      );
    }
  } else {
    return (
      <Menu>
        <Menu.ItemGroup title="Other Options:" />
        {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
        {buildMenuItem("volume", true, "New Volume-only Annotation")}
      </Menu>
    );
  }
};
*/



const CreateExplorativeModal = ({ datasetId, onClose }: Props) => {
  const dataset = useFetch(() => getDataset(datasetId), null, [datasetId]);
  const [annotationType, setAnnotationType] = useState("hybrid");
  const [userDefinedWithFallback, setUserDefinedWithFallback] = useState(true);
  const [userDefinedResolutionIndices, setUserDefinedResolutionIndices] = useState([0, 10000]);

  if (dataset === null) {
    return (
          <Modal
      title={`Create New Annotation for dataset “${datasetId.name}”`}
      visible
      width={500}
      footer={null}
      onCancel={onClose}
    ><Spin /></Modal>)
  }

  const segmentationLayer = getSegmentationLayer(dataset);
  // doesSupportVolumeWithFallback(dataset);

  const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
  console.log(datasetResolutionInfo);
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
    isFallbackSegmentationAlwaysOn || (userDefinedWithFallback && !isFallbackSegmentationAlwaysOff);

  const isFallbackSegmentationSelectedString = isFallbackSegmentationSelected ? "true" : "false";

  const fallbackCheckbox = (
    <Checkbox
      onChange={e => setUserDefinedWithFallback(e.target.checked)}
      checked={isFallbackSegmentationSelected}
      disabled={!isFallbackSegmentationOptional}
    >
      With Existing Segmentation
    </Checkbox>
  );

  return (
    <Modal
      title={`Create New Annotation for dataset “${dataset.name}”`}
      visible
      width={500}
      footer={null}
      onCancel={onClose}
    >
      <Radio.Group onChange={e => setAnnotationType(e.target.value)} value={annotationType}>
        <Radio value="hybrid">Skeleton and Volume</Radio>
        <Radio value="skeleton">Skeleton only</Radio>
        <Radio value="volume">Volume only</Radio>
      </Radio.Group>
      <br />
      {fallbackCheckbox}
      <br />
      <Checkbox>
        Restrict Resolutions{" "}
        <Tooltip
          title="Select which of the dataset resolutions the volume data should be created at. Resolution 1 is the most detailed, 4-4-2 is downsampled by factor 4 in x and y, and by factor 2 in z."
          placement="right"
        >
          <InfoCircleOutlined />
        </Tooltip>
      </Checkbox>
      <br />
      <div style={{display: "inline-block", width: "20%"}}>{datasetResolutionInfo.getResolutionByIndex(Math.max(lowestResolutionIndex, userDefinedResolutionIndices[0])).join("-")}</div>
      <div style={{display: "inline-block", width: "50%"}}>
        <Slider tooltipVisible={false} onChange={value => setUserDefinedResolutionIndices(value)} range step={1} min={lowestResolutionIndex} max={highestResolutionIndex} value={[userDefinedResolutionIndices[0], userDefinedResolutionIndices[1]]} />
      </div>
      <div style={{display: "inline-block", width: "20%"}}>{datasetResolutionInfo.getResolutionByIndex(Math.min(highestResolutionIndex, userDefinedResolutionIndices[1])).join("-")}</div>
      <br />
      <Link
        to={`/datasets/${dataset.owningOrganization}/${
          dataset.name
        }/createExplorative/${annotationType}/${isFallbackSegmentationSelectedString}`}
        title="Create new annotation with selected properties"
      >
        <Button size="large" type="primary">
          Create Annotation
        </Button>
      </Link>
    </Modal>
  );
};

export default CreateExplorativeModal;
