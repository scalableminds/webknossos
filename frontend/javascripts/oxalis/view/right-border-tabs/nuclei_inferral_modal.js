// @flow
import React, { useEffect, useState } from "react";
import { type APIDataset } from "types/api_flow_types";
import { Modal, Select, Button } from "antd";
import { startNucleiInferralJob } from "admin/admin_rest_api";
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import { Unicode } from "oxalis/constants";

const { ThinSpace } = Unicode;

type Props = {
  dataset: APIDataset,
  handleClose: () => void,
};

export default function NucleiInferralModal(props: Props) {
  const { dataset, handleClose } = props;
  const [selectedColorLayerName, setSelectedColorLayerName] = useState(null);
  const colorLayerNames = getColorLayers(dataset).map(layer => layer.name);
  useEffect(() => {
    if (colorLayerNames.length === 1) {
      setSelectedColorLayerName(colorLayerNames[0]);
    }
  });
  if (colorLayerNames.length < 1) {
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
        <>
          The nuclei inferral job has been started. You can look in the{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          view under Administration for details on the progress of this job.
        </>,
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
        this dataset once it has finished. The new dataset will contain the detected nuclei as a
        segmentation layer.{" "}
      </p>
      <p>
        <b>
          Note that this feature is still experimental. Nuclei detection currently works best with
          EM data and a resolution of approximately 200{ThinSpace}nm per voxel. The inferral process
          will automatically use the magnification that matches that resolution best.
        </b>
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
      {colorLayerNames.length > 1 ? (
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
              {colorLayerNames.map(colorLayerName => (
                <Select.Option key={colorLayerName} value={colorLayerName}>
                  {colorLayerName}
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
