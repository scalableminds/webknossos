// @flow
import React, { useEffect, useState, type Node } from "react";
import { type APIDataset, type APIJob } from "types/api_flow_types";
import { Modal, Select, Button } from "antd";
import { startNucleiInferralJob, startNucleiReconstructionJob } from "admin/admin_rest_api";
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import { Unicode } from "oxalis/constants";
import { capitalizeWords } from "libs/utils";

const { ThinSpace } = Unicode;

type Props = {
  dataset: APIDataset,
  handleClose: () => void,
};
type StartingJoblModalProps = {
  ...Props,
  jobApiCall: string => Promise<APIJob>,
  jobName: string,
  description: Node,
};

function StartingJobModal(props: StartingJoblModalProps) {
  const { dataset, handleClose, jobName, description, jobApiCall } = props;
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
      await jobApiCall(selectedColorLayerName);
      Toast.info(
        <>
          The {jobName} job has been started. You can look in the{" "}
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
        `The ${jobName} job could not be started. Please contact an administrator or look in the console for more details.`,
      );
      handleClose();
    }
  };

  return (
    <Modal
      title={`Start ${capitalizeWords(jobName)}`}
      onCancel={handleClose}
      visible
      width={700}
      footer={null}
    >
      {description}
      <br />
      <div style={{ textAlign: "center" }}>
        <img
          src="/assets/images/nuclei_inferral_example.jpg"
          alt={`${jobName} example`}
          style={{ width: 400, height: "auto", borderRadius: 3 }}
        />
      </div>
      <br />
      {colorLayerNames.length > 1 ? (
        <React.Fragment>
          <p>
            The detection approach uses a single color layer. Please select the layer that should be
            used for detection.
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
          Start {capitalizeWords(jobName)}
        </Button>
      </div>
    </Modal>
  );
}

export function NucleiInferralModal({ dataset, handleClose }: Props) {
  return (
    <StartingJobModal
      dataset={dataset}
      handleClose={handleClose}
      jobName="nuclei inferral"
      jobApiCall={colorLayerName =>
        startNucleiInferralJob(dataset.owningOrganization, dataset.name, colorLayerName)
      }
      description={
        <>
          <p>
            Start a job that automatically detects nuclei for this dataset. This job creates a copy
            of this dataset once it has finished. The new dataset will contain the detected nuclei
            as a segmentation layer.
          </p>
          <p>
            <b>
              Note that this feature is still experimental. Nuclei detection currently works best
              with EM data and a resolution of approximately 200{ThinSpace}nm per voxel. The
              inferral process will automatically use the magnification that matches that resolution
              best.
            </b>
          </p>
        </>
      }
    />
  );
}

export function NucleiReconstructionModal({ dataset, handleClose }: Props) {
  return (
    <StartingJobModal
      dataset={dataset}
      handleClose={handleClose}
      jobName="nuclei reconstruction"
      jobApiCall={colorLayerName =>
        startNucleiReconstructionJob(dataset.owningOrganization, dataset.name, colorLayerName)
      }
      description={
        <>
          <p>
            Start a job that automatically detects nuclei for this dataset. This job creates a copy
            of this dataset once it has finished. The new dataset will contain the detected nuclei
            as a segmentation layer.
          </p>
          <p>
            <b>
              Note that this feature is still experimental. Nuclei detection currently works best
              with EM data and a resolution of approximately 200{ThinSpace}nm per voxel. The
              inferral process will automatically use the magnification that matches that resolution
              best.
            </b>
          </p>
        </>
      }
    />
  );
}
