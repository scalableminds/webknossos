import { Tooltip, Typography } from "antd";
import { PlusSquareOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import React, { useState } from "react";
import _ from "lodash";
import { UserBoundingBoxInput } from "oxalis/view/components/setting_input_views";
import { Vector3, Vector6, BoundingBoxType, ControlModeEnum } from "oxalis/constants";
import {
  changeUserBoundingBoxAction,
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "oxalis/model/actions/annotation_actions";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { isAnnotationOwner } from "oxalis/model/accessors/annotation_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import * as Utils from "libs/utils";
import { OxalisState, UserBoundingBox } from "oxalis/store";
import DownloadModalView from "../action-bar/download_modal_view";
import { APIJobType } from "types/api_flow_types";

export default function BoundingBoxTab() {
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] =
    useState<UserBoundingBox | null>(null);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const allowUpdate = tracing.restrictions.allowUpdate;
  const isLockedByOwner = tracing.isLockedByOwner;
  const isOwner = useSelector((state: OxalisState) => isAnnotationOwner(state));
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const { userBoundingBoxes } = getSomeTracing(tracing);
  const dispatch = useDispatch();

  const setChangeBoundingBoxBounds = (id: number, boundingBox: BoundingBoxType) =>
    dispatch(
      changeUserBoundingBoxAction(id, {
        boundingBox,
      }),
    );

  const addNewBoundingBox = () => dispatch(addUserBoundingBoxAction());

  const setPosition = (position: Vector3) => dispatch(setPositionAction(position));

  const deleteBoundingBox = (id: number) => dispatch(deleteUserBoundingBoxAction(id));

  const setBoundingBoxVisibility = (id: number, isVisible: boolean) =>
    dispatch(
      changeUserBoundingBoxAction(id, {
        isVisible,
      }),
    );

  const setBoundingBoxName = (id: number, name: string) =>
    dispatch(
      changeUserBoundingBoxAction(id, {
        name,
      }),
    );

  const setBoundingBoxColor = (id: number, color: Vector3) =>
    dispatch(
      changeUserBoundingBoxAction(id, {
        color,
      }),
    );

  function handleBoundingBoxBoundingChange(id: number, boundingBox: Vector6) {
    setChangeBoundingBoxBounds(id, Utils.computeBoundingBoxFromArray(boundingBox));
  }

  function handleGoToBoundingBox(id: number) {
    const boundingBoxEntry = userBoundingBoxes.find((bbox) => bbox.id === id);

    if (!boundingBoxEntry) {
      return;
    }

    const { min, max } = boundingBoxEntry.boundingBox;
    const center: Vector3 = [
      min[0] + (max[0] - min[0]) / 2,
      min[1] + (max[1] - min[1]) / 2,
      min[2] + (max[2] - min[2]) / 2,
    ];
    setPosition(center);
  }

  const isViewMode = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );

  let maybeUneditableExplanation;
  if (isViewMode) {
    maybeUneditableExplanation = "Please create a new annotation to add custom bounding boxes.";
  } else if (!allowUpdate) {
    maybeUneditableExplanation =
      "Copy this annotation to your account to adapt the bounding boxes.";
  }

  const isExportEnabled = dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
    APIJobType.EXPORT_TIFF,
  );

  return (
    <div
      className="padded-tab-content"
      style={{
        minWidth: 300,
      }}
    >
      {/* In view mode, it's okay to render an empty list, since there will be
          an explanation below, anyway.
      */}
      {userBoundingBoxes.length > 0 || isViewMode ? (
        userBoundingBoxes.map((bb) => (
          <UserBoundingBoxInput
            key={bb.id}
            tooltipTitle="Format: minX, minY, minZ, width, height, depth"
            value={Utils.computeArrayFromBoundingBox(bb.boundingBox)}
            color={bb.color}
            name={bb.name}
            isExportEnabled={isExportEnabled}
            isVisible={bb.isVisible}
            onBoundingChange={_.partial(handleBoundingBoxBoundingChange, bb.id)}
            onDelete={_.partial(deleteBoundingBox, bb.id)}
            onExport={isExportEnabled ? _.partial(setSelectedBoundingBoxForExport, bb) : () => {}}
            onGoToBoundingBox={_.partial(handleGoToBoundingBox, bb.id)}
            onVisibilityChange={_.partial(setBoundingBoxVisibility, bb.id)}
            onNameChange={_.partial(setBoundingBoxName, bb.id)}
            onColorChange={_.partial(setBoundingBoxColor, bb.id)}
            disabled={!allowUpdate}
            isLockedByOwner={isLockedByOwner}
            isOwner={isOwner}
          />
        ))
      ) : (
        <div>No Bounding Boxes created yet.</div>
      )}
      <Typography.Text type="secondary">{maybeUneditableExplanation}</Typography.Text>
      {allowUpdate ? (
        <div style={{ display: "inline-block", width: "100%", textAlign: "center" }}>
          <Tooltip title="Click to add another bounding box.">
            <PlusSquareOutlined
              onClick={addNewBoundingBox}
              style={{
                cursor: "pointer",
                marginBottom: userBoundingBoxes.length === 0 ? 12 : 0,
              }}
            />
          </Tooltip>
        </div>
      ) : null}
      {selectedBoundingBoxForExport != null ? (
        <DownloadModalView
          isOpen
          isAnnotation
          onClose={() => setSelectedBoundingBoxForExport(null)}
          initialBoundingBoxId={selectedBoundingBoxForExport.id}
          initialTab="export"
        />
      ) : null}
    </div>
  );
}
