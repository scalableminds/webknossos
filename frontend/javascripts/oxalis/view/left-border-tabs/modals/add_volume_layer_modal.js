// @flow

import { Modal, Row } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import { NewVolumeLayerSelection } from "dashboard/advanced_dataset/create_explorative_modal";
import type { Tracing } from "oxalis/store";
import { addAnnotationLayer } from "admin/admin_rest_api";
import { getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracingLayers } from "oxalis/model/accessors/volumetracing_accessor";
import InputComponent from "oxalis/view/components/input_component";
import api from "oxalis/api/internal_api";

export default function AddVolumeLayerModal({
  dataset,
  onCancel,
  tracing,
}: {
  dataset: APIDataset,
  onCancel: () => void,
  tracing: Tracing,
}) {
  // const [isDownsampling, setIsDownsampling] = useState(false);
  const [selectedSegmentationLayerIndex, setSelectedSegmentationLayerIndex] = useState(null);
  const [newLayerName, setNewLayerName] = useState("Volume");
  const handleSetNewLayerName = evt => setNewLayerName(evt.target.value);

  const segmentationLayers = getSegmentationLayers(dataset);
  const volumeTracingLayers = getVolumeTracingLayers(dataset);

  const availableSegmentationLayers = _.differenceWith(segmentationLayers, volumeTracingLayers);

  const handleAddVolumeLayer = async () => {
    await api.tracing.save();

    if (selectedSegmentationLayerIndex == null) {
      await addAnnotationLayer(tracing.annotationId, tracing.annotationType, {
        typ: "Volume",
        name: newLayerName,
        fallbackLayerName: undefined,
        resolutionRestrictions: undefined,
      });
    } else {
      const fallbackLayerName = availableSegmentationLayers[selectedSegmentationLayerIndex].name;
      await addAnnotationLayer(tracing.annotationId, tracing.annotationType, {
        typ: "Volume",
        name: newLayerName,
        fallbackLayerName,
        resolutionRestrictions: undefined,
      });
    }
    await api.tracing.hardReload();
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
      Layer Name:{" "}
      <InputComponent
        size="small"
        onChange={handleSetNewLayerName}
        value={newLayerName}
        style={{ width: "60%", marginBottom: 16, marginLeft: 8 }}
      />
      <NewVolumeLayerSelection
        dataset={dataset}
        segmentationLayers={availableSegmentationLayers}
        selectedSegmentationLayerIndex={selectedSegmentationLayerIndex}
        setSelectedSegmentationLayerIndex={setSelectedSegmentationLayerIndex}
      />
      <Row type="flex" justify="center" align="middle">
        <AsyncButton onClick={handleAddVolumeLayer} type="primary" icon={<PlusOutlined />}>
          Add Volume Annotation Layer
        </AsyncButton>
      </Row>
    </Modal>
  );
}
