import { Alert, Button, Checkbox, Col, Divider, Modal, Radio, Row, Space, Tooltip } from "antd";
import React, { useState } from "react";

import { startRenderAnimationJob } from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import Store, { type MeshInformation, type UserBoundingBox } from "oxalis/store";

import { InfoCircleOutlined } from "@ant-design/icons";
import {
  PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { LayerSelection } from "components/layer_selection";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import {
  computeBoundingBoxFromBoundingBoxObject,
  computeBoundingBoxObjectFromBoundingBox,
} from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import { getSceneControllerOrNull } from "oxalis/controller/scene_controller_provider";
import {
  getColorLayers,
  getEffectiveIntensityRange,
  getLayerByName,
  getMagInfo,
  is2dDataset,
} from "oxalis/model/accessors/dataset_accessor";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type { Mesh } from "three";
import {
  type APIDataLayer,
  APIJobType,
  type APISegmentationLayer,
  CAMERA_POSITIONS,
  MOVIE_RESOLUTIONS,
  type RenderAnimationOptions,
} from "types/api_types";
import { BoundingBoxSelection } from "./starting_job_modals";

type Props = {
  isOpen: boolean;
  onClose: React.MouseEventHandler;
};

// When creating the texture for the dataset animation, we aim for for texture with the largest side of roughly this size
const TARGET_TEXTURE_SIZE = 2000; // in pixels

// Maximum number of triangles allowed in an animation to not overload the server
// Remember: The backend worker code only simplifies meshes with >100.000 polygons; all other meshes are rendered as is
const MAX_TRIANGLES_PER_ANIMATION = 20_000_000; // 20 million triangles

function selectMagForTextureCreation(
  colorLayer: APIDataLayer,
  boundingBox: BoundingBox,
): [Vector3, number] {
  // Utility method to determine the best mag in relation to the dataset size to create the textures in the worker job
  // We aim to create textures with a rough length/height of 2000px (aka target_video_frame_size)

  const longestSide = Math.max(...boundingBox.getSize());
  const dimensionLongestSide = boundingBox.getSize().indexOf(longestSide);

  let bestMag = colorLayer.resolutions[0];
  let bestDifference = Number.POSITIVE_INFINITY;

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

// Count triangles in a mesh or group of meshes
function countTrianglesInMeshes(meshes: RenderAnimationOptions["meshes"]): number {
  const sceneController = getSceneControllerOrNull();
  if (!sceneController) return 0;

  const { segmentMeshController } = sceneController;
  let totalTriangles = 0;

  meshes.forEach((meshInfo) => {
    // meshInfo can contain different properties depending on the mesh source
    const segmentId = meshInfo.segmentId;
    if (segmentId == null) return;

    const meshGroup = segmentMeshController.getMeshGeometryInBestLOD(
      segmentId,
      meshInfo.layerName,
      meshInfo.seedAdditionalCoordinates || null,
    );

    if (meshGroup) {
      meshGroup.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.geometry?.index) {
          // For indexed geometries, count triangles from the index
          totalTriangles += mesh.geometry.index.count / 3;
        } else if (mesh.geometry?.attributes.position) {
          // For non-indexed geometries, count triangles from position attribute
          totalTriangles += mesh.geometry.attributes.position.count / 3;
        }
      });
    }
  });

  return totalTriangles;
}

export default function CreateAnimationModalWrapper(props: Props) {
  const dataset = useWkSelector((state) => state.dataset);

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
  const dataset = useWkSelector((state) => state.dataset);
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const activeUser = useWkSelector((state) => state.activeUser);

  const colorLayers = getColorLayers(dataset);

  const colorLayer = colorLayers[0];
  const [selectedColorLayerName, setSelectedColorLayerName] = useState<string>(colorLayer.name);
  const selectedColorLayer = getLayerByName(dataset, selectedColorLayerName);

  const [isValid, setIsValid] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const rawUserBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));
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

  const formatTriangles = (totalTriangles: number) => {
    const trianglesInThousands = totalTriangles / 1000;
    const factor = 10; // for 1 decimal place
    const adjusted = Math.ceil(trianglesInThousands * factor) / factor;
    return adjusted.toFixed(1);
  };

  const validateAnimationOptions = (
    colorLayer: APIDataLayer,
    selectedBoundingBox: BoundingBox,
    renderingBoundingBox: BoundingBox,
    meshes: RenderAnimationOptions["meshes"],
  ) => {
    //  Validate the select parameters and dataset to make sure it actually works and does not overload the server

    const state = Store.getState();
    const errorMessages: string[] = [];

    const [_, estimatedTextureSize] = selectMagForTextureCreation(colorLayer, renderingBoundingBox);

    const hasEnoughMags = estimatedTextureSize < 1.5 * TARGET_TEXTURE_SIZE;
    if (!hasEnoughMags)
      errorMessages.push(
        "The selected bounding box is too large to create an animation. Either shrink the bounding box or consider downsampling the dataset to coarser magnifications.",
      );

    const isDtypeSupported = colorLayer.elementClass !== "uint24";
    if (!isDtypeSupported)
      errorMessages.push("Sorry, animations are not supported for uInt24 color layers.");

    const isDataset3D =
      !is2dDataset(state.dataset) && (colorLayer.additionalAxes?.length || 0) === 0;
    if (!isDataset3D) errorMessages.push("Sorry, animations are only supported for 3D datasets.");

    // Count triangles in all meshes
    const totalTriangles = countTrianglesInMeshes(meshes);
    const isTooManyTriangles = totalTriangles > MAX_TRIANGLES_PER_ANIMATION;
    if (isTooManyTriangles)
      errorMessages.push(
        `You selected too many meshes for the animation. Please keep the total triangle count below ${(MAX_TRIANGLES_PER_ANIMATION / 1000).toFixed(0)}k to create an animation. Current count: ${formatTriangles(totalTriangles)}k triangles.`,
      );

    const isBoundingBoxEmpty = selectedBoundingBox.getVolume() === 0;
    if (isBoundingBoxEmpty)
      errorMessages.push(
        "Please select a bounding box that is not empty. Width, height, and depth of the bounding box must be larger than zero.",
      );

    const isRenderingBoundingBoxEmpty = renderingBoundingBox.getVolume() === 0;
    if (isRenderingBoundingBoxEmpty && !isBoundingBoxEmpty)
      errorMessages.push(
        "Your selected bounding box is located outside the dataset's volume. Please select a bounding box contained within the dataset's outer bounds.",
      );

    const validationStatus =
      hasEnoughMags &&
      isDtypeSupported &&
      isDataset3D &&
      !isTooManyTriangles &&
      !isBoundingBoxEmpty &&
      !isRenderingBoundingBoxEmpty;

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

      const adhocMagIndex = getMagInfo(layer.resolutions).getClosestExistingIndex(
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

    // the actual rendering bounding box in Blender is the intersection of the selected user bounding box and the color layer's outer bounds
    const colorLayerBB = new BoundingBox(
      computeBoundingBoxFromBoundingBoxObject(selectedColorLayer.boundingBox),
    );
    const selectedBoundingBox = new BoundingBox(boundingBox);
    const renderingBoundingBox = selectedBoundingBox.intersectedWith(colorLayerBB);

    const [magForTextures, _] = selectMagForTextureCreation(colorLayer, renderingBoundingBox);

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

    if (
      !validateAnimationOptions(
        selectedColorLayer,
        selectedBoundingBox,
        renderingBoundingBox,
        meshes,
      )
    )
      return;

    startRenderAnimationJob(state.dataset.id, animationOptions);

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
      onCancel={onClose}
      okText={isFeatureDisabled ? "This feature is not available" : "Start Animation"}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        isFeatureDisabled ? (
          <Tooltip
            key="ok"
            title="This feature is not available on your WEBKNOSSOS server. Contact your administrator."
          >
            <Button type="primary" disabled>
              Start Animation
            </Button>
          </Tooltip>
        ) : (
          <Button key="ok" type="primary" onClick={submitJob} disabled={activeUser == null}>
            Start Animation
          </Button>
        ),
      ]}
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
                  Standard Definition (640 × 360)
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
              getReadableNameForLayer={(layer) => layer.name}
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
              style={{ marginTop: 18, width: "100%" }}
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
