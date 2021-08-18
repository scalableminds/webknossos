// @flow
import React, { useEffect, useState } from "react";
import { type APIDataset } from "types/api_flow_types";
import { Modal, Select, Button } from "antd";
import { startNucleiInferralJob } from "admin/admin_rest_api";
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";

type Props = {
  dataset: APIDataset,
  handleClose: () => void,
};

export default function NucleiInferralModal(props: Props) {
  const { dataset, handleClose } = props;
  const [selectedColorLayerName, setSelectedColorLayerName] = useState(null);
  const colorLayers = getColorLayers(dataset);
  useEffect(() => {
    if (colorLayers.length === 1) {
      setSelectedColorLayerName(colorLayers[0].name);
    }
  });
  if (colorLayers.length < 1) {
    return null;
  }

  const onChange = selectedLayerName => {
    setSelectedColorLayerName(selectedLayerName);
  };

  const startJob = async () => {
    if (selectedColorLayerName == null) {
      return;
    }
    try {
      await startNucleiInferralJob(
        dataset.owningOrganization,
        dataset.name,
        selectedColorLayerName,
      );
      Toast.info(
        "The nuclei inferral job has been started. You can look in the Processing Jobs view under Administration for details on the progress of this job.",
      );
      handleClose();
    } catch (error) {
      console.error(error);
      Toast.error(
        "The nuclei inferral job could not be started. Please contact an administrator or look in the console for more details.",
      );
      handleClose();
    }
  };

  return (
    <Modal title="Start Nuclei Inferral" onCancel={handleClose} visible width={700} footer={null}>
      <p>
        Start a job that automatically detects nuclei for this dataset. This job creates a copy of
        this dataset once it has finished. This copy contains the detected nuclei as a segmentation
        layer.
      </p>
      <br />
      <div style={{ textAlign: "center" }}>
        <img
          src="/assets/images/nuclei_inferral_example.jpg"
          alt="Nuclei inferral example"
          style={{ width: 400, height: "auto", borderRadius: 3 }}
        />
      </div>
      <br />
      {colorLayers.length > 1 ? (
        <React.Fragment>
          <p>
            The detection approach uses a single color layer to predict the nuclei. Please select
            the layer that should be used for detection.
          </p>
          <div style={{ textAlign: "center" }}>
            <Select
              showSearch
              style={{ width: 200 }}
              placeholder="Select a color layer"
              optionFilterProp="children"
              onChange={onChange}
              filterOption={(input, option) =>
                option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
              }
            >
              {colorLayers.map(colorLayer => (
                <Select.Option key={colorLayer.name} value={colorLayer.name}>
                  {colorLayer.name}
                </Select.Option>
              ))}
            </Select>
          </div>
          <br />
        </React.Fragment>
      ) : null}
      <div style={{ textAlign: "center" }}>
        <Button type="primary" disabled={selectedColorLayerName == null} onClick={startJob}>
          Start Nuclei Inferral
        </Button>
      </div>
    </Modal>
  );
}
