// @flow

import { Button, Modal, Row } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import { NewVolumeLayerSelection } from "dashboard/advanced_dataset/create_explorative_modal";
import { getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracingLayers } from "oxalis/model/accessors/volumetracing_accessor";

export default function AddVolumeLayerModal({
  dataset,
  onCancel,
}: {
  dataset: APIDataset,
  onCancel: () => void,
}) {
  // const [isDownsampling, setIsDownsampling] = useState(false);
  const [selectedSegmentationLayerIndex, setSelectedSegmentationLayerIndex] = useState(null);

  const segmentationLayers = getSegmentationLayers(dataset);
  const volumeTracingLayers = getVolumeTracingLayers(dataset);

  const availableSegmentationLayers = _.differenceWith(segmentationLayers, volumeTracingLayers);

  const handleAddVolumeLayer = () => {
    console.log("todo: handleAddVolumeLayer");
    if (selectedSegmentationLayerIndex == null) {
      console.log("create fresh layer");
    } else {
      const newLayer = availableSegmentationLayers[selectedSegmentationLayerIndex];
      console.log("base new layer on", newLayer);
    }
  };

  return (
    <Modal
      title="Add Volume Annotation Layer"
      footer={null}
      width={500}
      maskClosable={false}
      onCancel={onCancel}
      visible
    >
      <NewVolumeLayerSelection
        dataset={dataset}
        segmentationLayers={availableSegmentationLayers}
        selectedSegmentationLayerIndex={selectedSegmentationLayerIndex}
        setSelectedSegmentationLayerIndex={setSelectedSegmentationLayerIndex}
      />
      <Row type="flex" justify="center" align="middle">
        <Button onClick={handleAddVolumeLayer} type="primary">
          <PlusOutlined />
          Add Volume Annotation Layer
        </Button>
      </Row>
    </Modal>
  );
}
