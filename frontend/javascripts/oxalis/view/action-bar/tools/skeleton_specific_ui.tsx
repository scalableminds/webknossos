import { ExportOutlined } from "@ant-design/icons";
import { Badge, Space } from "antd";
import { useState } from "react";
import { useDispatch } from "react-redux";

import { useWkSelector } from "libs/react_hooks";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import { Toolkit } from "oxalis/model/accessors/tool_accessor";
import { getActiveSegmentationTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import {
  createTreeAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { MaterializeVolumeAnnotationModal } from "oxalis/view/action-bar/starting_job_modals";
import ButtonComponent, { ToggleButton } from "oxalis/view/components/button_component";

import { useIsActiveUserAdminOrManager } from "libs/react_helpers";
import { APIJobType } from "types/api_types";
import { IMG_STYLE_FOR_SPACEY_ICONS, NARROW_BUTTON_STYLE } from "./tool_helpers";

export function SkeletonSpecificButtons() {
  const dispatch = useDispatch();
  const isMergerModeEnabled = useWkSelector(
    (state) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const [showMaterializeVolumeAnnotationModal, setShowMaterializeVolumeAnnotationModal] =
    useState<boolean>(false);
  const isNewNodeNewTreeModeOn = useWkSelector((state) => state.userConfiguration.newNodeNewTree);
  const isContinuousNodeCreationEnabled = useWkSelector(
    (state) => state.userConfiguration.continuousNodeCreation,
  );
  const isSplitToolkit = useWkSelector(
    (state) => state.userConfiguration.activeToolkit === Toolkit.SPLIT_SEGMENTS,
  );
  const toggleContinuousNodeCreation = () =>
    dispatch(updateUserSettingAction("continuousNodeCreation", !isContinuousNodeCreationEnabled));

  const dataset = useWkSelector((state) => state.dataset);
  const isUserAdminOrManager = useIsActiveUserAdminOrManager();

  const segmentationTracingLayer = useWkSelector((state) => getActiveSegmentationTracing(state));
  const isEditableMappingActive =
    segmentationTracingLayer != null && !!segmentationTracingLayer.hasEditableMapping;
  const isMappingLockedWithNonNull =
    segmentationTracingLayer != null &&
    !!segmentationTracingLayer.mappingIsLocked &&
    segmentationTracingLayer.mappingName != null;
  const isMergerModeDisabled = isEditableMappingActive || isMappingLockedWithNonNull;
  const mergerModeTooltipText = isEditableMappingActive
    ? "Merger mode cannot be enabled while an editable mapping is active."
    : isMappingLockedWithNonNull
      ? "Merger mode cannot be enabled while a mapping is locked. Please create a new annotation and use the merger mode there."
      : "Toggle Merger Mode - When enabled, skeletons that connect multiple segments will merge those segments.";

  const toggleNewNodeNewTreeMode = () =>
    dispatch(updateUserSettingAction("newNodeNewTree", !isNewNodeNewTreeModeOn));

  const toggleMergerMode = () => dispatch(setMergerModeEnabledAction(!isMergerModeEnabled));

  const isMaterializeVolumeAnnotationEnabled =
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
      APIJobType.MATERIALIZE_VOLUME_ANNOTATION,
    );

  return (
    <Space.Compact
      style={{
        marginLeft: 10,
      }}
    >
      <CreateTreeButton />
      {isSplitToolkit ? null : (
        <ToggleButton
          style={NARROW_BUTTON_STYLE}
          onClick={toggleNewNodeNewTreeMode}
          active={isNewNodeNewTreeModeOn}
          title="Toggle the Single node Tree (soma clicking) mode - If enabled, each node creation will create a new tree."
        >
          <img
            style={IMG_STYLE_FOR_SPACEY_ICONS}
            src="/assets/images/soma-clicking-icon.svg"
            alt="Single Node Tree Mode"
          />
        </ToggleButton>
      )}
      {isSplitToolkit ? null : (
        <ToggleButton
          active={isMergerModeEnabled}
          style={{
            ...NARROW_BUTTON_STYLE,
            opacity: isMergerModeDisabled ? 0.5 : 1,
          }}
          onClick={toggleMergerMode}
          disabled={isMergerModeDisabled}
          title={mergerModeTooltipText}
        >
          <img
            style={IMG_STYLE_FOR_SPACEY_ICONS}
            src="/assets/images/merger-mode-icon.svg"
            alt="Merger Mode"
          />
        </ToggleButton>
      )}
      <ToggleButton
        active={isContinuousNodeCreationEnabled}
        onClick={toggleContinuousNodeCreation}
        style={NARROW_BUTTON_STYLE}
        title="When activated, clicking and dragging creates nodes like a drawing tool."
      >
        <i className="fas fa-pen" />
      </ToggleButton>

      {isMergerModeEnabled && isMaterializeVolumeAnnotationEnabled && isUserAdminOrManager && (
        <ButtonComponent
          style={NARROW_BUTTON_STYLE}
          onClick={() => setShowMaterializeVolumeAnnotationModal(true)}
          title="Materialize this merger mode annotation into a new dataset."
        >
          <ExportOutlined />
        </ButtonComponent>
      )}
      {isMaterializeVolumeAnnotationEnabled && showMaterializeVolumeAnnotationModal && (
        <MaterializeVolumeAnnotationModal
          handleClose={() => setShowMaterializeVolumeAnnotationModal(false)}
        />
      )}
    </Space.Compact>
  );
}

function CreateTreeButton() {
  const dispatch = useDispatch();
  const activeTree = useWkSelector((state) => getActiveTree(state.annotation.skeleton));
  const rgbColorString =
    activeTree != null
      ? `rgb(${activeTree.color.map((c) => Math.round(c * 255)).join(",")})`
      : "transparent";
  const activeTreeHint =
    activeTree != null
      ? `The active tree id is ${activeTree.treeId}.`
      : "No tree is currently selected";

  const handleCreateTree = () => dispatch(createTreeAction());

  return (
    <Badge
      dot
      style={{
        boxShadow: "none",
        background: rgbColorString,
        zIndex: 1000,
      }}
    >
      <ButtonComponent
        onClick={handleCreateTree}
        style={{ ...NARROW_BUTTON_STYLE, paddingRight: 5 }}
        title={`Create a new Tree (C) – ${activeTreeHint}`}
      >
        <i
          style={{
            opacity: 0.9,
            transform: "scale(0.9) translate(-2px, -1px)",
            marginRight: 3,
          }}
          className="fas fa-project-diagram"
        />
        <i
          className="fas fa-plus"
          style={{
            position: "absolute",
            top: 13,
            left: 21,
            fontSize: 11,
          }}
        />
      </ButtonComponent>
    </Badge>
  );
}
