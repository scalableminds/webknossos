import { Checkbox, Col, Divider, Modal, Radio, Row, Space, Tooltip } from "antd";
import { useSelector } from "react-redux";
import React, { useState } from "react";

import { startRenderAnimationJob } from "admin/admin_rest_api";
import Toast from "libs/toast";
import _ from "lodash";
import Store, { OxalisState, UserBoundingBox } from "oxalis/store";

import { getColorLayers, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { BoundingBoxSelection, LayerSelection } from "../right-border-tabs/starting_job_modals";
import {
  computeBoundingBoxFromBoundingBoxObject,
  computeBoundingBoxObjectFromBoundingBox,
} from "libs/utils";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import { CAMERA_POSITIONS, RenderAnimationOptions, MOVIE_RESOLUTIONS } from "types/api_flow_types";
import { InfoCircleOutlined } from "@ant-design/icons";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import {
  PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";

type Props = {
  isOpen: boolean;
  onClose: React.MouseEventHandler;
};

function CreateAnimationModal(props: Props) {
  const { isOpen, onClose } = props;
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);

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
  const [areMeshesEnabled, setMeshesEnabled] = useState(true);

  const arePaidFeaturesAllowed = isFeatureAllowedByPricingPlan(
    activeOrganization,
    PricingPlanEnum.Team,
  );

  const validate = () => {
    // TODO
    // Bounging Box size
    // number of meshes?
    // add mag existence checks to avoid downloading huge amounts of data
    // supported dtypes
    // only 3D datasets
    return true;
  };

  const submitJob = (evt: React.MouseEvent) => {
    const state = Store.getState();
    const boundingBox = computeBoundingBoxObjectFromBoundingBox(
      userBoundingBoxes.find((bb) => bb.id === selectedBoundingBoxId)!.boundingBox,
    );
    const meshSegmentIds = [] as number[]; // TODO gather selected mesh ids

    const animationOptions: RenderAnimationOptions = {
      layerName: selectedLayerName,
      segmentationLayerName: "segmentation",
      meshfileName: "meshfile.hdf5",
      meshSegmentIds,
      boundingBox,
      intensityMin: 0,
      intensityMax: 255, // TODO use from current view config
      includeWatermark: isWatermarkEnabled,
      movieResolution: selectedMovieResolution,
      cameraPosition: selectedCameraPosition,
    };

    if (!validate()) {
      // TODO show better errors
      Toast.error("Options for animation are not valid");
    }

    startRenderAnimationJob(state.dataset.owningOrganization, state.dataset.name, animationOptions);

    Toast.info(
      <>
        The job to render this dataset as an animation has been started. See the{" "}
        <a target="_blank" href="/jobs" rel="noopener noreferrer">
          Processing Jobs
        </a>{" "}
        for details on the progress of this job.
      </>,
    );
    
    onClose(evt)
  };

  return (
    <Modal
      title="Create Animation"
      open={isOpen}
      width={700}
      onOk={submitJob}
      onCancel={onClose}
      okText="Start Rendering"
    >
      <React.Fragment>
        <Row gutter={8}>
          <Col span={8} style={{ textAlign: "center" }}>
            <img
              src="/assets/images/animation-illustration.png"
              alt="Render an animation showing your dataset in 3D"
              style={{ width: 160, display: "inline-block" }}
            />
          </Col>
          <Col span={16}>
            <p>
              Create a short, engaging animation of your data. Watch as the block of volumetric image data
              shrinks to reveal segmented objects. Choose from three perspective options and select
              the color layer and meshes you want to render.
            </p>
            <p>
              For custom animations, please{" "}
              <a target="_blank" href="mailto:hello@webknossos.org" rel="noopener noreferrer">
                contact us
              </a>
              .
            </p>
          </Col>
        </Row>
        <Divider
          style={{
            margin: "18px 0",
          }}
        >
          Animation Setup
        </Divider>
        <Row gutter={[8, 30]}>
          <Col span={8}>Camera Position</Col>
          <Col span={16}>
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
                  Static camera looking at XY-viewport{" "}
                  <Tooltip title="Cooming soon" placement="right">
                    <InfoCircleOutlined />
                  </Tooltip>
                </Radio.Button>
                <Radio.Button value={CAMERA_POSITIONS.STATIC_YZ} disabled>
                  Static camera looking at YZ-viewport{" "}
                  <Tooltip title="Cooming soon" placement="right">
                    <InfoCircleOutlined />
                  </Tooltip>
                </Radio.Button>
              </Space>
            </Radio.Group>
          </Col>

          <Col span={8}>Movie Resolution</Col>
          <Col span={16}>
            <Radio.Group
              value={selectedMovieResolution}
              onChange={(ev) => setMovieResolution(ev.target.value)}
              optionType="default"
            >
              <Space direction="vertical">
                <Radio.Button value={MOVIE_RESOLUTIONS.SD}>
                  Standard Definition (640 × 480)
                </Radio.Button>
                <Radio.Button value={MOVIE_RESOLUTIONS.HD} disabled={!arePaidFeaturesAllowed}>
                  <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
                    High Definition (1920 × 1080)
                  </PricingEnforcedSpan>
                </Radio.Button>
              </Space>
            </Radio.Group>
          </Col>

          <Col span={8}>Options</Col>
          <Col span={16}>
            <Space direction="vertical">
              <Checkbox
                checked={areMeshesEnabled}
                onChange={(ev) => setMeshesEnabled(ev.target.checked)}
              >
                Include the currently selected 3D meshes
                <Tooltip
                  title="When enabled all meshes currently visibile in WEBKNOSSOS will be included in the rendered scene."
                  placement="right"
                >
                  <InfoCircleOutlined style={{ marginLeft: 10 }} />
                </Tooltip>
              </Checkbox>
              <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
                <Checkbox
                  disabled={!arePaidFeaturesAllowed}
                  checked={isWatermarkEnabled}
                  onChange={(ev) => setWatermarkEnabled(ev.target.checked)}
                >
                  Include WEBKNOSSOS Watermark
                </Checkbox>
              </PricingEnforcedSpan>
            </Space>
          </Col>
        </Row>
        <Divider style={{ margin: "18px 0" }}>Layer & Bounding Box</Divider>
        <Row gutter={[8, 20]}>
          <Col span={8}>Layer</Col>
          <Col span={16}>
            <LayerSelection
              layers={colorLayers}
              value={selectedLayerName}
              onChange={setSelectedLayerName}
              tracing={tracing}
              style={{ width: "100%" }}
            />
          </Col>
          <Col span={8}>Bounding Box</Col>
          <Col span={16}>
            <BoundingBoxSelection
              value={selectedBoundingBoxId}
              userBoundingBoxes={userBoundingBoxes}
              setSelectedBoundingBoxId={(boxId: number | null) => {
                if (boxId != null) {
                  setSelectedBoundingBoxId(boxId);
                }
              }}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>
      </React.Fragment>
    </Modal>
  );
}

export default CreateAnimationModal;
