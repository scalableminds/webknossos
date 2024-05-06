import { Alert, Checkbox, Col, Divider, Modal, Radio, Row, Space, Tooltip } from "antd";
import { useSelector } from "react-redux";
import React, { useState } from "react";

import { startRenderAnimationJob } from "admin/admin_rest_api";
import Toast from "libs/toast";
import _ from "lodash";
import Store, { MeshInformation, OxalisState, UserBoundingBox } from "oxalis/store";

import {
  getColorLayers,
  getEffectiveIntensityRange,
  getLayerByName,
  getResolutionInfo,
  is2dDataset,
} from "oxalis/model/accessors/dataset_accessor";
import {
  computeBoundingBoxFromBoundingBoxObject,
  computeBoundingBoxObjectFromBoundingBox,
} from "libs/utils";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import {
  CAMERA_POSITIONS,
  RenderAnimationOptions,
  MOVIE_RESOLUTIONS,
  APIDataLayer,
  APIJobType,
  APISegmentationLayer,
} from "types/api_flow_types";
import { InfoCircleOutlined } from "@ant-design/icons";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import {
  PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { BoundingBoxType, Vector3 } from "oxalis/constants";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { BoundingBoxSelection, LayerSelection } from "./starting_job_modals";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";

type Props = {
  isOpen: boolean;
  onClose: React.MouseEventHandler;
};

// When creating the texture for the dataset animation, we aim for for texture with the largest side of roughly this size
const TARGET_TEXTURE_SIZE = 2000; // in pixels
const MAX_MESHES_PER_ANIMATION = 40; // arbitrary limit to not overload the server when rendering many large STL files

function selectMagForTextureCreation(
  colorLayer: APIDataLayer,
  boundingBox: BoundingBoxType,
): [Vector3, number] {
  // Utility method to determine the best mag in relation to the dataset size to create the textures in the worker job
  // We aim to create textures with a rough length/height of 2000px (aka target_video_frame_size)
  const colorLayerBB = new BoundingBox(
    computeBoundingBoxFromBoundingBoxObject(colorLayer.boundingBox),
  );
  const bb = new BoundingBox(boundingBox).intersectedWith(colorLayerBB);

  const longestSide = Math.max(...bb.getSize());
  const dimensionLongestSide = bb.getSize().indexOf(longestSide);

  let bestMag = colorLayer.resolutions[0];
  let bestDifference = Infinity;

  for (const mag of colorLayer.resolutions) {
    const size = longestSide / mag[dimensionLongestSide];
    const diff = Math.abs(TARGET_TEXTURE_SIZE - size);

    if (bestDifference > diff) {
      bestDifference = diff;
      bestMag = mag;
    }
  }

  return [bestMag, bestDifference];
}

export default function CreateAnimationModalWrapper(props: Props) {
  const dataset = useSelector((state: OxalisState) => state.dataset);

  // early stop if no color layer exists
  const colorLayers = getColorLayers(dataset);
  if (colorLayers.length === 0) {
    const { isOpen, onClose } = props;
    return (
      <Modal open={isOpen} onOk={onClose} onCancel={onClose} title="Create Animation">
        WEBKNOSSOS cannot create animations for datasets without color layers.
      </Modal>
    );
  }

  return <CreateAnimationModal {...props} />;
}

function CreateAnimationModal(props: Props) {
  const { isOpen, onClose } = props;
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);

  const colorLayers = getColorLayers(dataset);

  const colorLayer = colorLayers[0];
  const [selectedColorLayerName, setSelectedColorLayerName] = useState<string>(colorLayer.name);
  const selectedColorLayer = getLayerByName(dataset, selectedColorLayerName);

  const [isValid, setIsValid] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const rawUserBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const userBoundingBoxes = [
    ...rawUserBoundingBoxes,
    {
      id: -1,
      name: "Full layer",
      boundingBox: computeBoundingBoxFromBoundingBoxObject(selectedColorLayer.boundingBox),
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

  const validateAnimationOptions = (
    colorLayer: APIDataLayer,
    selectedBoundingBox: BoundingBoxType,
    meshes: Partial<MeshInformation>[],
  ) => {
    //  Validate the select parameters and dataset to make sure it actually works and does not overload the server

    const state = Store.getState();
    const errorMessages: string[] = [];

    const [_, estimatedTextureSize] = selectMagForTextureCreation(colorLayer, selectedBoundingBox);

    const hasEnoughMags = estimatedTextureSize < 1.5 * TARGET_TEXTURE_SIZE;
    if (!hasEnoughMags)
      errorMessages.push(
        "The selected bounding box is too large to create an animation. Either shrink the bounding box or consider downsampling the dataset to coarser magnifications.",
      );

    const isDtypeSupported = colorLayer.elementClass !== "uint24";
    if (!isDtypeSupported)
      errorMessages.push("Sorry, animations are not supported for uInt24 datasets.");

    const isDataset3D =
      !is2dDataset(state.dataset) && (colorLayer.additionalAxes?.length || 0) === 0;
    if (!isDataset3D) errorMessages.push("Sorry, animations are only supported for 3D datasets.");

    const isTooManyMeshes = meshes.length > MAX_MESHES_PER_ANIMATION;
    if (isTooManyMeshes)
      errorMessages.push(
        `You selected too many meshes for the animation. Please keep the number of meshes below ${MAX_MESHES_PER_ANIMATION} to create an animation.`,
      );

    const validationStatus = hasEnoughMags && isDtypeSupported && isDataset3D && !isTooManyMeshes;

    setValidationErrors(errorMessages);
    setIsValid(validationStatus);

    return validationStatus;
  };

  const submitJob = (evt: React.MouseEvent) => {
    const state = Store.getState();
    const boundingBox = userBoundingBoxes.find(
      (bb) => bb.id === selectedBoundingBoxId,
    )!.boundingBox;

    // Submit currently visible pre-computed & ad-hoc meshes
    const axis = getAdditionalCoordinatesAsString([]);
    const layerNames = Object.keys(state.localSegmentationData);
    const { preferredQualityForMeshAdHocComputation } = state.temporaryConfiguration;

    const meshes: RenderAnimationOptions["meshes"] = layerNames.flatMap((layerName) => {
      const meshInfos = state.localSegmentationData[layerName]?.meshes?.[axis] || {};

      const layer = getLayerByName(state.dataset, layerName) as APISegmentationLayer;
      const fullLayerName = layer.fallbackLayerInfo?.name || layerName;

      const adhocMagIndex = getResolutionInfo(layer.resolutions).getClosestExistingIndex(
        preferredQualityForMeshAdHocComputation,
      );
      const adhocMag = layer.resolutions[adhocMagIndex];

      return Object.values(meshInfos)
        .filter((meshInfo: MeshInformation) => meshInfo.isVisible)
        .flatMap((meshInfo: MeshInformation) => {
          return {
            layerName: fullLayerName,
            tracingId: layer.tracingId || null,
            adhocMag,
            ...meshInfo,
          };
        });
    });

    // Submit the configured min/max intensity info to support float datasets
    const [intensityMin, intensityMax] = getEffectiveIntensityRange(
      dataset,
      selectedColorLayerName,
      state.datasetConfiguration,
    );

    const [magForTextures, _] = selectMagForTextureCreation(colorLayer, boundingBox);

    const animationOptions: RenderAnimationOptions = {
      layerName: selectedColorLayerName,
      meshes,
      intensityMin,
      intensityMax,
      magForTextures,
      boundingBox: computeBoundingBoxObjectFromBoundingBox(boundingBox),
      includeWatermark: isWatermarkEnabled,
      movieResolution: selectedMovieResolution,
      cameraPosition: selectedCameraPosition,
    };

    if (!validateAnimationOptions(colorLayer, boundingBox, meshes)) return;

    startRenderAnimationJob(state.dataset.owningOrganization, state.dataset.name, animationOptions);

    Toast.info(
      <>
        A background job to create this animation has been started. See the{" "}
        <a target="_blank" href="/jobs" rel="noopener noreferrer">
          Processing Jobs
        </a>{" "}
        for details on the progress of this job.
      </>,
    );

    onClose(evt);
  };

  const isFeatureDisabled = !(
    dataset.dataStore.jobsEnabled &&
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.RENDER_ANIMATION)
  );

  return (
    <Modal
      title="Create Animation"
      open={isOpen}
      width={700}
      onOk={submitJob}
      onCancel={onClose}
      okText={isFeatureDisabled ? "This feature is not available" : "Start Animation"}
      okButtonProps={{ disabled: isFeatureDisabled }}
    >
      <React.Fragment>
        <Row gutter={8}>
          <Col span={12} style={{ textAlign: "center" }}>
            <video
              src="https://static.webknossos.org/assets/docs/webknossos_animation_example.mp4"
              style={{ width: "100%", display: "inline-block", objectFit: "cover" }}
              controls={true}
              autoPlay
              muted={true}
            />
          </Col>
          <Col span={12}>
            <p style={{ paddingLeft: 10 }}>
              Create a short, engaging animation of your data. Watch as the block of volumetric
              image data shrinks to reveal segmented objects. Choose from three perspective options
              and select the color layer and meshes you want to render. The resulting video file can
              be used for presentations, publications, or your website.
            </p>
            <p style={{ paddingLeft: 10 }}>
              For custom animations, please{" "}
              <a target="_blank" href="mailto:sales@webknossos.org" rel="noopener noreferrer">
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
                <Radio.Button value={CAMERA_POSITIONS.STATIC_XZ}>
                  Static camera looking at XZ-viewport{" "}
                </Radio.Button>
                <Radio.Button value={CAMERA_POSITIONS.STATIC_YZ}>
                  Static camera looking at YZ-viewport{" "}
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
                  title="When enabled, all meshes currently visible in WEBKNOSSOS will be included in the animation."
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
              value={selectedColorLayerName}
              onChange={setSelectedColorLayerName}
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
        {!isValid ? (
          <Row gutter={[8, 20]}>
            <Alert
              type="error"
              style={{ marginTop: 18 }}
              message={
                <ul>
                  {validationErrors.map((errorMessage) => (
                    <li key={errorMessage.slice(5)}>{errorMessage}</li>
                  ))}
                </ul>
              }
            />
          </Row>
        ) : null}
      </React.Fragment>
    </Modal>
  );
}
