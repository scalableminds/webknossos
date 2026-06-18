import { InfoCircleOutlined, LockOutlined } from "@ant-design/icons";
import animationExamplePoster from "@images/animation-example-poster.jpg";
import {
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { startRenderAnimationJob } from "admin/rest_api";
import {
  Alert,
  Button,
  Checkbox,
  Col,
  Divider,
  Flex,
  Modal,
  type ModalProps,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { LayerSelection } from "components/layer_selection";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import {
  computeBoundingBoxFromBoundingBoxObject,
  computeBoundingBoxObjectFromBoundingBox,
} from "libs/utils";
import type React from "react";
import { useState } from "react";
import type { Mesh } from "three";
import {
  type APIDataLayer,
  APIJobCommand,
  type APISegmentationLayer,
  CAMERA_POSITIONS,
  MOVIE_DURATIONS,
  MOVIE_RESOLUTIONS,
  type RenderAnimationOptions,
} from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getSceneControllerOrNull } from "viewer/controller/scene_controller_provider";
import {
  getColorLayers,
  getLayerByName,
  getMagInfo,
  is2dDataset,
} from "viewer/model/accessors/dataset_accessor";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { getSegmentColorAsRGBA } from "viewer/model/accessors/volumetracing_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import Store, { type MeshInformation, type UserBoundingBox } from "viewer/store";
import { BoundingBoxSelection } from "viewer/view/ai_jobs/components/bounding_box_selection";

type Props = {
  isOpen: boolean;
  onClose: ModalProps["onCancel"];
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

  let bestMag = colorLayer.mags[0].mag;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (const magObj of colorLayer.mags) {
    const size = longestSide / magObj.mag[dimensionLongestSide];
    const diff = Math.abs(TARGET_TEXTURE_SIZE - size);

    if (bestDifference > diff) {
      bestDifference = diff;
      bestMag = magObj.mag;
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
      <Modal open={isOpen} onOk={onClose} onCancel={onClose} title="Create animation">
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
  const [selectedMovieDuration, setMovieDuration] = useState(MOVIE_DURATIONS.STANDARD);
  const [isWatermarkEnabled, setWatermarkEnabled] = useState(true);
  const [areMeshesEnabled, setMeshesEnabled] = useState(true);
  const [areSkeletonsEnabled, setSkeletonsEnabled] = useState(false);
  const [isImageDataHidden, setImageDataHidden] = useState(false);
  const [isSaveBlenderFileEnabled, setSaveBlenderFileEnabled] = useState(false);

  const { token } = theme.useToken();

  const annotationType = useWkSelector((state) => state.annotation.annotationType);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const isAnnotationMode = annotationType !== "View";
  const hasSkeleton = useWkSelector((state) => state.annotation.skeleton != null);
  const isSuperUser = activeUser?.isSuperUser ?? false;

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

  const submitJob = (evt: React.MouseEvent<HTMLButtonElement>) => {
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

      const adhocMagIndex = getMagInfo(layer.mags).getClosestExistingIndex(
        preferredQualityForMeshAdHocComputation,
      );
      const adhocMag = getMagInfo(layer.mags).getMagByIndexOrThrow(adhocMagIndex);

      return Object.values(meshInfos)
        .filter((meshInfo: MeshInformation) => meshInfo.isVisible)
        .flatMap((meshInfo: MeshInformation) => {
          const segmentColorRGBA = getSegmentColorAsRGBA(state, meshInfo.segmentId, layerName);
          return {
            layerName: fullLayerName,
            tracingId: layer.tracingId || null,
            annotationId: state.annotation?.annotationId || null,
            adhocMag,
            color: segmentColorRGBA,
            ...meshInfo,
          };
        });
    });

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
      magForTextures,
      boundingBox: computeBoundingBoxObjectFromBoundingBox(boundingBox),
      includeWatermark: isWatermarkEnabled,
      movieResolution: selectedMovieResolution,
      movieDuration: selectedMovieDuration,
      cameraPosition: selectedCameraPosition,
      annotationId: isAnnotationMode ? annotationId : null,
      includeSkeletons: isAnnotationMode && hasSkeleton && areSkeletonsEnabled,
      hideImageData: isImageDataHidden,
      saveBlenderFile: isSuperUser && isSaveBlenderFileEnabled,
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

    onClose?.(evt);
  };

  const isFeatureDisabled = !(
    dataset.dataStore.jobsEnabled &&
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobCommand.RENDER_ANIMATION)
  );

  const fieldLabel = (label: string) => (
    <Typography.Text strong style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
      {label}
    </Typography.Text>
  );

  const cameraPositionOptions = [
    { value: CAMERA_POSITIONS.MOVING, label: "Orbiting camera (circles the dataset)" },
    { value: CAMERA_POSITIONS.STATIC_XY, label: "Fixed camera — XY view" },
    { value: CAMERA_POSITIONS.STATIC_XZ, label: "Fixed camera — XZ view" },
    { value: CAMERA_POSITIONS.STATIC_YZ, label: "Fixed camera — YZ view" },
    {
      value: CAMERA_POSITIONS.STATIC_ISOMETRIC,
      label: "Fixed isometric view (all 3 viewports)",
    },
  ];

  const startButton = isFeatureDisabled ? (
    <Tooltip title="This feature is not available on your WEBKNOSSOS server. Contact your administrator.">
      <Button type="primary" disabled>
        Create animation
      </Button>
    </Tooltip>
  ) : (
    <Button type="primary" onClick={submitJob} disabled={activeUser == null}>
      Start animation
    </Button>
  );

  return (
    <Modal
      title="Create Animation"
      open={isOpen}
      width={900}
      onCancel={onClose}
      footer={
        <Flex justify="space-between" align="center" gap={12}>
          <span>
            {isSuperUser ? (
              <>
                <Checkbox
                  checked={isSaveBlenderFileEnabled}
                  onChange={(ev) => setSaveBlenderFileEnabled(ev.target.checked)}
                >
                  Save Blender file
                  <Tooltip
                    title="When enabled, the intermediate Blender file will be saved alongside the animation output for debugging purposes."
                    placement="top"
                  >
                    <InfoCircleOutlined className="icon-margin-left" />
                  </Tooltip>
                </Checkbox>
                <Tag style={{ marginInlineStart: 8 }}>Super user</Tag>
              </>
            ) : null}
          </span>
          <Space>
            <Button onClick={(evt: React.MouseEvent<HTMLButtonElement>) => onClose?.(evt)}>
              Cancel
            </Button>
            {startButton}
          </Space>
        </Flex>
      }
    >
      <Row gutter={32} style={{ marginBottom: 24 }}>
        {/* Left column: preview & description */}
        <Col span={9}>
          <Flex vertical gap={18}>
            <video
              src="https://static.webknossos.org/assets/docs/webknossos_animation_example.mp4"
              poster={animationExamplePoster}
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                objectFit: "cover",
                borderRadius: token.borderRadiusLG,
                background: "#0d0f17",
              }}
              controls={true}
              autoPlay
              muted={true}
              preload="metadata"
            />
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              Render a short video of your data. Pick a camera path, resolution and duration, choose
              the layer and bounding box, and decide which meshes and skeletons to include.
              Rendering runs as a background job — you'll get an email when it's done, and the video
              will be available on the{" "}
              <a href="/jobs" target="_blank" rel="noopener noreferrer">
                Processing Jobs
              </a>{" "}
              page.
            </Typography.Text>
          </Flex>
        </Col>

        {/* Right column: form */}
        <Col span={15}>
          <Flex vertical gap={20}>
            <Flex vertical gap={16}>
              <Divider titlePlacement="left" style={{ margin: 0 }}>
                Camera &amp; quality
              </Divider>
              <div>
                {fieldLabel("Camera position")}
                <Select
                  value={selectedCameraPosition}
                  onChange={setCameraPosition}
                  options={cameraPositionOptions}
                  popupMatchSelectWidth={false}
                  style={{ width: "100%" }}
                />
              </div>
              <Row gutter={24}>
                <Col span={12}>
                  {fieldLabel("Movie resolution")}
                  <Segmented
                    block
                    value={selectedMovieResolution}
                    onChange={(value) => setMovieResolution(value as MOVIE_RESOLUTIONS)}
                    options={[
                      { value: MOVIE_RESOLUTIONS.SD, label: "SD · 640×360" },
                      {
                        value: MOVIE_RESOLUTIONS.HD,
                        disabled: !arePaidFeaturesAllowed,
                        label: (
                          <span>
                            HD · 1080p
                            {!arePaidFeaturesAllowed ? (
                              <LockOutlined style={{ marginInlineStart: 6, fontSize: 12 }} />
                            ) : null}
                          </span>
                        ),
                      },
                    ]}
                  />
                  {!arePaidFeaturesAllowed ? (
                    <Typography.Text
                      type="secondary"
                      style={{ display: "block", fontSize: 12, marginTop: 7 }}
                    >
                      <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
                        HD is available on a paid plan.
                      </PricingEnforcedSpan>
                    </Typography.Text>
                  ) : null}
                </Col>
                <Col span={12}>
                  {fieldLabel("Video duration")}
                  <Segmented
                    block
                    value={selectedMovieDuration}
                    onChange={(value) => setMovieDuration(value as MOVIE_DURATIONS)}
                    options={[
                      { value: MOVIE_DURATIONS.FAST, label: "Fast" },
                      { value: MOVIE_DURATIONS.STANDARD, label: "Standard" },
                      { value: MOVIE_DURATIONS.SLOW, label: "Slow" },
                    ]}
                  />
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", fontSize: 12, marginTop: 7 }}
                  >
                    ≈ 15s · 22s · 30s
                  </Typography.Text>
                </Col>
              </Row>
            </Flex>

            <Flex vertical gap={14}>
              <Divider titlePlacement="left" style={{ margin: 0 }}>
                Content
              </Divider>
              <Row gutter={[14, 14]}>
                <Col span={12}>
                  <Checkbox
                    checked={areMeshesEnabled}
                    onChange={(ev) => setMeshesEnabled(ev.target.checked)}
                  >
                    Include 3D meshes
                    <Tooltip
                      title="When enabled, all meshes currently visible in WEBKNOSSOS will be included in the animation."
                      placement="right"
                    >
                      <InfoCircleOutlined className="icon-margin-left" />
                    </Tooltip>
                  </Checkbox>
                </Col>
                {isAnnotationMode && hasSkeleton ? (
                  <Col span={12}>
                    <Checkbox
                      checked={areSkeletonsEnabled}
                      onChange={(ev) => setSkeletonsEnabled(ev.target.checked)}
                    >
                      Include skeletons
                      <Tooltip
                        title="When enabled, the visible skeleton trees of the current annotation will be included in the animation."
                        placement="right"
                      >
                        <InfoCircleOutlined className="icon-margin-left" />
                      </Tooltip>
                    </Checkbox>
                  </Col>
                ) : null}
                <Col span={12}>
                  <Checkbox
                    checked={isImageDataHidden}
                    onChange={(ev) => setImageDataHidden(ev.target.checked)}
                  >
                    Hide image data
                    <Tooltip
                      title="When enabled, the volumetric image data is hidden and only the meshes and skeletons are rendered."
                      placement="right"
                    >
                      <InfoCircleOutlined className="icon-margin-left" />
                    </Tooltip>
                  </Checkbox>
                </Col>
                <Col span={12}>
                  <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
                    <Checkbox
                      disabled={!arePaidFeaturesAllowed}
                      checked={isWatermarkEnabled}
                      onChange={(ev) => setWatermarkEnabled(ev.target.checked)}
                    >
                      WEBKNOSSOS watermark
                    </Checkbox>
                  </PricingEnforcedSpan>
                </Col>
              </Row>
            </Flex>

            <Flex vertical gap={14}>
              <Divider titlePlacement="left" style={{ margin: 0 }}>
                Layer &amp; data
              </Divider>
              <Row gutter={24}>
                <Col span={12}>
                  {fieldLabel("Layer")}
                  <LayerSelection
                    layers={colorLayers}
                    value={selectedColorLayerName}
                    onChange={setSelectedColorLayerName}
                    getReadableNameForLayer={(layer) => layer.name}
                    style={{ width: "100%" }}
                  />
                </Col>
                <Col span={12}>
                  {fieldLabel("Bounding box")}
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
            </Flex>

            {!isValid ? (
              <Alert
                type="error"
                message={
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {validationErrors.map((errorMessage) => (
                      <li key={errorMessage.slice(5)}>{errorMessage}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}
          </Flex>
        </Col>
      </Row>
    </Modal>
  );
}
