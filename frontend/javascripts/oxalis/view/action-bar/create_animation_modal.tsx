import { Checkbox, Col, Divider, Modal, ModalProps, Radio, Row, Space, Typography } from "antd";
import { useSelector } from "react-redux";
import React, { useState } from "react";

import { startRenderAnimationJob } from "admin/admin_rest_api";
import Toast from "libs/toast";
import _ from "lodash";
import Store, { OxalisState, UserBoundingBox } from "oxalis/store";

import { getColorLayers, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { BoundingBoxSelection, LayerSelection } from "../right-border-tabs/starting_job_modals";
import { computeBoundingBoxFromBoundingBoxObject } from "libs/utils";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";

type Props = {
  isOpen: boolean;
  onClose: ModalProps["onCancel"];
};

enum CAMERA_POSITIONS {
  MOVING,
  STATIC_XY,
  STATIC_YZ,
}

enum MOVIE_RESOLUTIONS {
  SD,
  HD,
}

function CreateAnimationModal(props: Props) {
  const { isOpen, onClose } = props;
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);

  const colorLayers = getColorLayers(dataset);

  const [selectedLayerName, setSelectedLayerName] = useState<string>(colorLayers[0].name);

  const selectedLayer = getLayerByName(dataset, selectedLayerName);

  const rawUserBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );

  const userBoundingBoxes = [
    ...rawUserBoundingBoxes,
    {
      id: -1,
      name: "Full layer",
      boundingBox: computeBoundingBoxFromBoundingBoxObject(selectedLayer.boundingBox),
      color: [255, 255, 255],
      isVisible: true,
    } as UserBoundingBox,
  ];

  const [selectedBoundingBoxId, setSelectedBoundingBoxId] = useState(userBoundingBoxes[0].id);

  const [selectedCameraPosition, setCameraPosition] = useState(CAMERA_POSITIONS.MOVING);
  const [selectedMovieResolution, setMovieResolution] = useState(MOVIE_RESOLUTIONS.SD);
  const [isWatermarkEnabled, setWatermarkEnabled] = useState(true);

  const submitJob = () => {
    const state = Store.getState();
    startRenderAnimationJob(
      state.dataset.owningOrganization,
      state.dataset.name,
      selectedLayerName,
    );

    Toast.info(
      <>
        The job to render this dataset as an animation has been started. See the{" "}
        <a target="_blank" href="/jobs" rel="noopener noreferrer">
          Processing Jobs
        </a>{" "}
        for details on the progress of this job.
      </>,
    );
  };

  return (
    <Modal
      title="Create an Animation"
      open={isOpen}
      width={800}
      onOk={submitJob}
      onCancel={onClose}
    >
      <React.Fragment>
        <Row>
          <Col>
            <video src="blob:https://youtu.be/8vol7QTDgFI" />
          </Col>
        </Row>
        <Row>
          <Col>
            <Typography.Text>Something Explanation</Typography.Text>
          </Col>
        </Row>
        <Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Animation Setup
          </Divider>

          <Col>
            Camera Position
            <Radio.Group
              value={selectedCameraPosition}
              onChange={(ev) => setCameraPosition(ev.target.value)}
              optionType="default"
            >
              <Space direction="vertical">
                <Radio.Button value={CAMERA_POSITIONS.MOVING}>
                  Camera circling around the dataset
                </Radio.Button>
                <Radio.Button value={CAMERA_POSITIONS.STATIC_XY} disabled>
                  Static camera looking at XY-viewport
                </Radio.Button>
                <Radio.Button value={CAMERA_POSITIONS.STATIC_YZ} disabled>
                  Static camera looking at YZ-viewport
                </Radio.Button>
              </Space>
            </Radio.Group>
          </Col>
          <Col>
            Movie Resolution
            <Radio.Group
              value={selectedMovieResolution}
              onChange={(ev) => setMovieResolution(ev.target.value)}
              optionType="default"
            >
              <Space direction="vertical">
                <Radio.Button value={MOVIE_RESOLUTIONS.SD}>
                  Standard Definition (640x480)
                </Radio.Button>
                <Radio.Button value={MOVIE_RESOLUTIONS.HD} disabled>
                  High Definition (1920x1080)
                </Radio.Button>
              </Space>
            </Radio.Group>
          </Col>
          <Col>
            <Checkbox
              checked={isWatermarkEnabled}
              onChange={(ev) => setWatermarkEnabled(ev.target.value)}
            >
              Include WEBKNOSSOS Watermark
            </Checkbox>
            <Checkbox
              checked={isWatermarkEnabled}
              onChange={(ev) => setWatermarkEnabled(ev.target.value)}
            >
              Include the currently selected 3D meshes
            </Checkbox>
          </Col>
        </Row>

        <Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Layer & Bounding Box
          </Divider>
          <LayerSelection
            layers={colorLayers}
            value={selectedLayerName}
            onChange={setSelectedLayerName}
            tracing={tracing}
            style={{ width: "100%" }}
          />

          <BoundingBoxSelection
            value={selectedBoundingBoxId}
            userBoundingBoxes={userBoundingBoxes}
            setSelectedBoundingBoxId={(boxId: number | null) => {
              if (boxId != null) {
                setSelectedBoundingBoxId(boxId);
              }
            }}
            style={{ width: "100%", marginTop: 10 }}
          />
        </Row>
      </React.Fragment>
    </Modal>
  );
}

export default CreateAnimationModal;
