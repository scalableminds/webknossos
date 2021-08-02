// @flow
import { Modal, Radio, Button, Checkbox } from "antd";
import React, { useState } from "react";
import type { APIDataset } from "types/api_flow_types";
import { Link } from "react-router-dom";

import {
  getSegmentationLayer,
  doesSupportVolumeWithFallback,
} from "oxalis/model/accessors/dataset_accessor";

type Props = {
  dataset: APIDataset,
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

const CreateExplorativeModal = ({ dataset, onClose }: Props) => {
  const segmentationLayer = getSegmentationLayer(dataset);
  // doesSupportVolumeWithFallback(dataset);

  const [annotationType, setAnnotationType] = useState("hybrid");
  const [userDefinedWithFallback, setUserDefinedWithFallback] = useState(true);

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
      <p>
        <Radio.Group onChange={e => setAnnotationType(e.target.value)} value={annotationType}>
          <Radio value="hybrid">Skeleton and Volume</Radio>
          <Radio value="skeleton">Skeleton only</Radio>
          <Radio value="volume">Volume only</Radio>
        </Radio.Group>
      </p>
      {fallbackCheckbox}
      <p>Restrict resolutions... TODO</p>
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
