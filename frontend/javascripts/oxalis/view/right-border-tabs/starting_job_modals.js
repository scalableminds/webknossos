// @flow
import React, { useEffect, useState, type Node } from "react";
import { type APIDataset, type APIJob } from "types/api_flow_types";
import { Modal, Select, Button } from "antd";
import { startNucleiInferralJob, startNeuronInferralJob } from "admin/admin_rest_api";
import { useSelector } from "react-redux";
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import Toast from "libs/toast";
import { type OxalisState, type UserBoundingBox } from "oxalis/store";
import { Unicode, type Vector3 } from "oxalis/constants";
import { capitalizeWords, computeArrayFromBoundingBox, rgbToHex } from "libs/utils";

const { ThinSpace } = Unicode;

const jobNameToImagePath = {
  "neuron inferral": "neuron_inferral_example.jpg",
  "nuclei inferral": "nuclei_inferral_example.jpg",
};

type Props = {
  handleClose: () => void,
};
type StartingJobModalProps = {
  ...Props,
  dataset: APIDataset,
  jobApiCall: (string, ?UserBoundingBox) => Promise<?APIJob>,
  jobName: string,
  description: Node,
  isBoundingBoxConfigurable?: boolean,
};

function StartingJobModal(props: StartingJobModalProps) {
  const isBoundingBoxConfigurable = props.isBoundingBoxConfigurable || false;
  const { dataset, handleClose, jobName, description, jobApiCall } = props;
  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const [selectedColorLayerName, setSelectedColorLayerName] = useState<?string>(null);
  const [selectedBoundingBox, setSelectedBoundingBox] = useState<?UserBoundingBox>(null);
  const colorLayerNames = getColorLayers(dataset).map(layer => layer.name);
  useEffect(() => {
    if (colorLayerNames.length === 1) {
      setSelectedColorLayerName(colorLayerNames[0]);
    }
  });
  if (colorLayerNames.length < 1) {
    return null;
  }
  const onChangeBoundingBox = (selectedBBoxId: number) => {
    const selectedBBox = userBoundingBoxes.find(bbox => bbox.id === selectedBBoxId);
    if (selectedBBox) {
      setSelectedBoundingBox(selectedBBox);
    }
  };
  const startJob = async () => {
    if (selectedColorLayerName == null) {
      return;
    }
    try {
      let apiJob;
      if (isBoundingBoxConfigurable) {
        apiJob = await jobApiCall(selectedColorLayerName, selectedBoundingBox);
      } else {
        apiJob = await jobApiCall(selectedColorLayerName);
      }
      if (!apiJob) {
        return;
      }
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

  const ColorLayerSelection = (): Node =>
    colorLayerNames.length > 1 ? (
      <React.Fragment>
        <p>Please select the layer that should be used for the inferral.</p>
        <div style={{ textAlign: "center" }}>
          <Select
            showSearch
            style={{ width: 300 }}
            placeholder="Select a color layer"
            optionFilterProp="children"
            value={selectedColorLayerName}
            onChange={setSelectedColorLayerName}
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
    ) : null;

  const renderUserBoundingBox = (bbox: ?UserBoundingBox) => {
    if (!bbox) {
      return null;
    }
    const upscaledColor = ((bbox.color.map(colorPart => colorPart * 255): any): Vector3);
    const colorAsHexString = rgbToHex(upscaledColor);
    return (
      <>
        <div
          className="color-display-wrapper"
          style={{
            backgroundColor: colorAsHexString,
            marginTop: -2,
            marginRight: 6,
          }}
        />
        {bbox.name} ({computeArrayFromBoundingBox(bbox.boundingBox).join(", ")})
      </>
    );
  };
  const BoundingBoxSelection = (): Node =>
    isBoundingBoxConfigurable ? (
      <React.Fragment>
        <p>
          Please select the bounding box for which the inferral should be computed. Note that large
          bounding boxes can take very long. You can create a new bounding box for the desired
          volume with the bounding box tool in the toolbar at the top. The created bounding boxes
          will be listed below.
        </p>
        <div style={{ textAlign: "center" }}>
          <Select
            showSearch
            style={{ width: 400 }}
            placeholder="Select a bounding box"
            optionFilterProp="children"
            value={renderUserBoundingBox(selectedBoundingBox)}
            onChange={onChangeBoundingBox}
            filterOption={(input, option) =>
              option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
            }
          >
            {userBoundingBoxes.map(userBB => (
              <Select.Option key={userBB.id} value={userBB.id}>
                {renderUserBoundingBox(userBB)}
              </Select.Option>
            ))}
          </Select>
        </div>
        <br />
      </React.Fragment>
    ) : null;

  const hasUnselectedOptions =
    selectedColorLayerName == null || (isBoundingBoxConfigurable && selectedBoundingBox == null);

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
          src={`/assets/images/${jobNameToImagePath[jobName]}`}
          alt={`${jobName} example`}
          style={{ width: 400, height: "auto", borderRadius: 3 }}
        />
      </div>
      <br />
      <ColorLayerSelection />
      <BoundingBoxSelection />
      <div style={{ textAlign: "center" }}>
        <Button type="primary" size="large" disabled={hasUnselectedOptions} onClick={startJob}>
          Start {capitalizeWords(jobName)}
        </Button>
      </div>
    </Modal>
  );
}

export function NucleiInferralModal({ handleClose }: Props) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
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

export function NeuronInferralModal({ handleClose }: Props) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  return (
    <StartingJobModal
      dataset={dataset}
      handleClose={handleClose}
      jobName="neuron inferral"
      isBoundingBoxConfigurable
      jobApiCall={async (colorLayerName, boundingBox) => {
        if (!boundingBox) {
          return Promise.resolve();
        }
        const bbox = computeArrayFromBoundingBox(boundingBox.boundingBox);
        return startNeuronInferralJob(
          dataset.owningOrganization,
          dataset.name,
          colorLayerName,
          bbox,
        );
      }}
      description={
        <>
          <p>
            Start a job that automatically detects the neurons for this dataset. This job creates a
            copy of this dataset once it has finished. The new dataset will contain the new
            segmentation which segments the neurons of the dataset.
          </p>
          <p>
            <b>
              Note that this feature is still experimental and can take a long time. Thus we suggest
              to use a small bounding box and not the full dataset extent. The neuron detection
              currently works best with EM data. The best resolution for the process will be chosen
              automatically.
            </b>
          </p>
        </>
      }
    />
  );
}
