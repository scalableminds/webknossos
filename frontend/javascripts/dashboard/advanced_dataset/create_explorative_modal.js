// @flow
import { Modal, Radio, Button } from "antd";
import React, { useState } from "react";
import type { APIDataset } from "types/api_flow_types";
import { Link } from "react-router-dom";

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
  const isFallbackSegmentationAvailable = false; // Todo depends on dataset

  const [annotationType, setAnnotationType] = useState("hybrid");
  const [withFallback, setWithFallback] = useState(isFallbackSegmentationAvailable);

  return (
    <Modal
      title={`Create New Annotation for dataset “${dataset.name}”`}
      visible
      width={500}
      footer={null}
      onCancel={onClose}
    >
      <p>
        <Radio.Group onChange={e => setAnnotationType(e.target.value)}>
          <Radio.Button value="hybrid">Skeleton and Volume</Radio.Button>
          <Radio.Button value="skeleton">Skeleton only</Radio.Button>
          <Radio.Button value="volume">Volume only</Radio.Button>
        </Radio.Group>
      </p>
      <p>Fallback Layer... TODO</p>
      <p>Restrict resolutions... TODO</p>
      <Link
        to={`/datasets/${dataset.owningOrganization}/${
          dataset.name
        }/createExplorative/${annotationType}/${withFallback}`}
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
