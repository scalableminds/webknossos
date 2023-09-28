import { Checkbox, Col, Divider, Modal, ModalProps, Radio, Row, Space, Typography } from "antd";
import { useSelector } from "react-redux";
import React, { useState } from "react";

import { startcreateAnimationJob } from "admin/admin_rest_api";
import Toast from "libs/toast";
import _ from "lodash";
import Store, { OxalisState, UserBoundingBox } from "oxalis/store";

import { getColorLayers, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { BoundingBoxSelection, LayerSelection } from "../right-border-tabs/starting_job_modals";
import { computeBoundingBoxFromBoundingBoxObject } from "libs/utils";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import { CAMERA_POSITIONS, CreateAnimationOptions, MOVIE_RESOLUTIONS } from "types/api_flow_types";

type Props = {
  isOpen: boolean;
  onClose: ModalProps["onCancel"];
};

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
    const boundingBox = userBoundingBoxes.find(
      (bb) => bb.id === selectedBoundingBoxId,
    )?.boundingBox;
    const meshIds = []; // TODO gather selected mesh ids

    const animationOptions: CreateAnimationOptions = {
      layerName: selectedLayerName,
      boundingBox,
      includeWatermark: isWatermarkEnabled,
      meshIds,
      movieResolution: selectedMovieResolution,
      cameraPosition: selectedCameraPosition,
    };

    startcreateAnimationJob(state.dataset.owningOrganization, state.dataset.name, animationOptions);

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
            <img
              src="https://miro.medium.com/v2/resize:fit:1400/0*AFr8RQpIteOQidsD"
              alt="An example previewing a WEBKNOSSOS animation"
              style={{ height: 300 }}
            />
          </Col>
        </Row>
        <Row
          style={{
            margin: "18px 0",
          }}
        >
          <Col>
            <Typography.Text>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris ac nisi mauris. Nunc
              et enim malesuada, semper lacus ac, posuere ipsum. Aliquam cursus consectetur auctor.
              Donec consequat libero aliquam, accumsan leo in, fermentum nisi. Nunc ac neque sed
              felis finibus facilisis id et magna. Aenean at est a lectus efficitur fringilla vel
              eget ex. Donec quis ipsum et arcu pharetra pellentesque sed eu odio. In aliquet
              commodo egestas
            </Typography.Text>
          </Col>
        </Row>
        <Row gutter={8}>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Animation Setup
          </Divider>

          <Col span={12}>
            <Typography.Title level={5}>Camera Position</Typography.Title>
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
          <Col span={12}>
            <Typography.Title level={5}>Movie Resolution</Typography.Title>
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
          <Col span={12}>
          <Typography.Title level={5}>Options</Typography.Title>
            <Space direction="vertical">
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
            </Space>
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
