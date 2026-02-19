import { DeleteOutlined } from "@ant-design/icons";
import { Flex, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { settings } from "messages";
import React, { useCallback } from "react";
import { useDispatch } from "react-redux";
import type { AnnotationLayerType } from "types/api_types";
import { AnnotationLayerEnum } from "types/api_types";
import { userSettings } from "types/schemas/user_settings.schema";
import Constants, { ControlModeEnum, LongUnitToShortUnitMap } from "viewer/constants";
import defaultState from "viewer/default_state";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  setNodeRadiusAction,
  setShowSkeletonsAction,
} from "viewer/model/actions/skeletontracing_actions";
import { deleteAnnotationLayer } from "viewer/model/sagas/volume/update_actions";
import { Model } from "viewer/singletons";
import ButtonComponent from "viewer/view/components/button_component";
import {
  LogSliderSetting,
  NumberSliderSetting,
  SwitchSetting,
} from "viewer/view/components/setting_input_views";
import { confirmAsync } from "../../../../dashboard/dataset/helper_components";
import { DummyDragHandle } from "./drag_handle";
import LayerTransformationIcon from "./layer_transformation_icon";

export default function SkeletonLayerSettings() {
  const dispatch = useDispatch();
  const annotation = useWkSelector((state) => state.annotation);
  const userConfiguration = useWkSelector((state) => state.userConfiguration);
  const dataset = useWkSelector((state) => state.dataset);
  const controlMode = useWkSelector((state) => state.temporaryConfiguration.controlMode);
  const isArbitraryMode = useWkSelector((state) =>
    Constants.MODES_ARBITRARY.includes(state.temporaryConfiguration.viewMode),
  );

  const isPublicViewMode = controlMode === ControlModeEnum.VIEW;

  const onChangeShowSkeletons = useCallback(
    (value: boolean) => {
      dispatch(setShowSkeletonsAction(value));
    },
    [dispatch],
  );

  const onChangeRadius = useCallback(
    (radius: number) => {
      dispatch(setNodeRadiusAction(radius));
    },
    [dispatch],
  );

  const onChangeUser = useCallback(
    (propertyName: string, value: any) => {
      dispatch(updateUserSettingAction(propertyName as any, value));
    },
    [dispatch],
  );

  const deleteAnnotationLayerIfConfirmed = useCallback(
    async (
      readableAnnotationLayerName: string,
      type: AnnotationLayerType,
      layerTracingId: string,
    ) => {
      const shouldDelete = await confirmAsync({
        title: `Deleting an annotation layer makes its content and history inaccessible. This cannot be undone. Are you sure you want to delete this layer?`,
        okText: `Yes, delete annotation layer "${readableAnnotationLayerName}"`,
        cancelText: "Cancel",
        okButtonProps: {
          danger: true,
          block: true,
          style: { whiteSpace: "normal", height: "auto", margin: "10px 0 0 0" },
        },
        cancelButtonProps: {
          block: true,
        },
      });
      if (!shouldDelete) return;
      dispatch(
        pushSaveQueueTransaction([
          deleteAnnotationLayer(layerTracingId, readableAnnotationLayerName, type),
        ]),
      );
      await Model.ensureSavedState();
      location.reload();
    },
    [dispatch],
  );

  const onChangeParticleSize = useCallback(
    (value: number) => onChangeUser("particleSize", value),
    [onChangeUser],
  );

  const onChangeClippingDistanceArbitrary = useCallback(
    (value: number) => onChangeUser("clippingDistanceArbitrary", value),
    [onChangeUser],
  );

  const onChangeClippingDistance = useCallback(
    (value: number) => onChangeUser("clippingDistance", value),
    [onChangeUser],
  );

  const onChangeOverrideNodeRadius = useCallback(
    (value: boolean) => onChangeUser("overrideNodeRadius", value),
    [onChangeUser],
  );

  const onChangeCenterNewNode = useCallback(
    (value: boolean) => onChangeUser("centerNewNode", value),
    [onChangeUser],
  );

  const onChangeApplyNodeRotation = useCallback(
    (value: boolean) => onChangeUser("applyNodeRotationOnActivation", value),
    [onChangeUser],
  );

  const onChangeHighlightCommentedNodes = useCallback(
    (value: boolean) => onChangeUser("highlightCommentedNodes", value),
    [onChangeUser],
  );

  if (isPublicViewMode || annotation.skeleton == null) {
    return null;
  }

  const readableName = "Skeleton";
  const skeletonTracing = enforceSkeletonTracing(annotation);
  const isOnlyAnnotationLayer = annotation.annotationLayers.length === 1;
  const { showSkeletons, tracingId } = skeletonTracing;
  const activeNodeRadius = getActiveNode(skeletonTracing)?.radius ?? 0;
  const unit = LongUnitToShortUnitMap[dataset.dataSource.scale.unit];

  return (
    <React.Fragment>
      <Flex
        style={{
          paddingRight: 1,
        }}
        align="center"
      >
        <DummyDragHandle tooltipTitle="Layer not movable: Skeleton layers are always rendered on top." />
        <div
          style={{
            flexGrow: 1,
            marginRight: 8,
            wordBreak: "break-all",
          }}
        >
          <FastTooltip
            title={showSkeletons ? "Hide skeleton layer" : "Show skeleton layer"}
            placement="top"
          >
            {/* This div is necessary for the tooltip to be displayed */}
            <div
              style={{
                display: "inline-block",
                marginRight: 8,
              }}
            >
              <Switch
                size="small"
                onChange={() => onChangeShowSkeletons(!showSkeletons)}
                checked={showSkeletons}
              />
            </div>
          </FastTooltip>
          <span
            style={{
              fontWeight: 700,
              wordWrap: "break-word",
              flex: 1,
            }}
          >
            {readableName}
          </span>
        </div>
        <Flex
          style={{
            paddingRight: 1,
          }}
        >
          <LayerTransformationIcon layer={{ category: "skeleton", name: tracingId }} />
          {!isOnlyAnnotationLayer ? (
            <ButtonComponent
              variant="text"
              color="default"
              size="small"
              onClick={() =>
                deleteAnnotationLayerIfConfirmed(
                  readableName,
                  AnnotationLayerEnum.Skeleton,
                  annotation.skeleton!.tracingId,
                )
              }
              icon={<DeleteOutlined />}
              title="Delete this annotation layer."
            />
          ) : null}
        </Flex>
      </Flex>
      {showSkeletons ? (
        <div
          style={{
            marginLeft: 10,
          }}
        >
          <LogSliderSetting
            label={`Node Radius (${unit})`}
            min={userSettings.nodeRadius.minimum}
            max={userSettings.nodeRadius.maximum}
            roundToDigit={0}
            value={activeNodeRadius}
            onChange={onChangeRadius}
            disabled={userConfiguration.overrideNodeRadius || activeNodeRadius === 0}
            defaultValue={Constants.DEFAULT_NODE_RADIUS}
          />
          <NumberSliderSetting
            label={
              (userConfiguration.overrideNodeRadius
                ? settings.particleSize
                : `Min. ${settings.particleSize}`) + ` (${unit})`
            }
            min={userSettings.particleSize.minimum}
            max={userSettings.particleSize.maximum}
            step={0.1}
            value={userConfiguration.particleSize}
            onChange={onChangeParticleSize}
            defaultValue={defaultState.userConfiguration.particleSize}
          />
          {isArbitraryMode ? (
            <NumberSliderSetting
              label={settings.clippingDistanceArbitrary}
              min={userSettings.clippingDistanceArbitrary.minimum}
              max={userSettings.clippingDistanceArbitrary.maximum}
              value={userConfiguration.clippingDistanceArbitrary}
              onChange={onChangeClippingDistanceArbitrary}
              defaultValue={defaultState.userConfiguration.clippingDistanceArbitrary}
            />
          ) : (
            <LogSliderSetting
              label={settings.clippingDistance + ` (${unit})`}
              roundToDigit={3}
              min={userSettings.clippingDistance.minimum}
              max={userSettings.clippingDistance.maximum}
              value={userConfiguration.clippingDistance}
              onChange={onChangeClippingDistance}
              defaultValue={defaultState.userConfiguration.clippingDistance}
            />
          )}
          <SwitchSetting
            label={settings.overrideNodeRadius}
            value={userConfiguration.overrideNodeRadius}
            onChange={onChangeOverrideNodeRadius}
          />
          <SwitchSetting
            label={settings.centerNewNode}
            value={userConfiguration.centerNewNode}
            onChange={onChangeCenterNewNode}
            tooltipText="When disabled, the active node will not be centered after node creation/deletion."
          />
          <SwitchSetting
            label={settings.applyNodeRotationOnActivation}
            value={userConfiguration.applyNodeRotationOnActivation}
            onChange={onChangeApplyNodeRotation}
            tooltipText="If enabled, the rotation that was active when a node was created will be set when activating the node."
          />
          <SwitchSetting
            label={settings.highlightCommentedNodes}
            value={userConfiguration.highlightCommentedNodes}
            onChange={onChangeHighlightCommentedNodes}
          />{" "}
        </div>
      ) : null}
    </React.Fragment>
  );
}
