/**
 * tracing_settings_view.js
 * @flow
 */
import { Tooltip } from "antd";
import { PlusSquareOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import React, { useState } from "react";
import _ from "lodash";

import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import type { Vector3, Vector6, BoundingBoxType } from "oxalis/constants";
import { UserBoundingBoxInput } from "oxalis/view/components/setting_input_views";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  changeUserBoundingBoxAction,
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "oxalis/model/actions/annotation_actions";
import * as Utils from "libs/utils";

import ExportBoundingBoxModal from "oxalis/view/right-border-tabs/export_bounding_box_modal";

export default function BoundingBoxTab() {
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] = useState(null);
  const tracing = useSelector(state => state.tracing);
  const dataset = useSelector(state => state.dataset);
  const { userBoundingBoxes } = getSomeTracing(tracing);

  const dispatch = useDispatch();
  const setChangeBoundingBoxBounds = (id: number, boundingBox: BoundingBoxType) =>
    dispatch(changeUserBoundingBoxAction(id, { boundingBox }));
  const addNewBoundingBox = () => dispatch(addUserBoundingBoxAction());

  const setPosition = (position: Vector3) => dispatch(setPositionAction(position));

  const deleteBoundingBox = (id: number) => dispatch(deleteUserBoundingBoxAction(id));
  const setBoundingBoxVisibility = (id: number, isVisible: boolean) =>
    dispatch(changeUserBoundingBoxAction(id, { isVisible }));
  const setBoundingBoxName = (id: number, name: string) =>
    dispatch(changeUserBoundingBoxAction(id, { name }));
  const setBoundingBoxColor = (id: number, color: Vector3) =>
    dispatch(changeUserBoundingBoxAction(id, { color }));

  function handleBoundingBoxBoundingChange(id: number, boundingBox: Vector6) {
    setChangeBoundingBoxBounds(id, Utils.computeBoundingBoxFromArray(boundingBox));
  }

  function handleGoToBoundingBox(id: number) {
    const boundingBoxEntry = userBoundingBoxes.find(bbox => bbox.id === id);
    if (!boundingBoxEntry) {
      return;
    }
    const { min, max } = boundingBoxEntry.boundingBox;
    const center = [
      min[0] + (max[0] - min[0]) / 2,
      min[1] + (max[1] - min[1]) / 2,
      min[2] + (max[2] - min[2]) / 2,
    ];
    setPosition(center);
  }

  return (
    <div className="padded-tab-content" style={{ minWidth: 300 }}>
      {userBoundingBoxes.length > 0 ? (
        userBoundingBoxes.map(bb => (
          <UserBoundingBoxInput
            key={bb.id}
            tooltipTitle="Format: minX, minY, minZ, width, height, depth"
            value={Utils.computeArrayFromBoundingBox(bb.boundingBox)}
            color={bb.color}
            name={bb.name}
            isExportEnabled={dataset.jobsEnabled}
            isVisible={bb.isVisible}
            onBoundingChange={_.partial(handleBoundingBoxBoundingChange, bb.id)}
            onDelete={_.partial(deleteBoundingBox, bb.id)}
            onExport={
              dataset.jobsEnabled ? _.partial(setSelectedBoundingBoxForExport, bb) : () => {}
            }
            onGoToBoundingBox={_.partial(handleGoToBoundingBox, bb.id)}
            onVisibilityChange={_.partial(setBoundingBoxVisibility, bb.id)}
            onNameChange={_.partial(setBoundingBoxName, bb.id)}
            onColorChange={_.partial(setBoundingBoxColor, bb.id)}
          />
        ))
      ) : (
        <div>No Bounding Boxes created yet.</div>
      )}
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
      {selectedBoundingBoxForExport != null ? (
        <ExportBoundingBoxModal
          dataset={dataset}
          tracing={tracing}
          boundingBox={selectedBoundingBoxForExport.boundingBox}
          handleClose={() => setSelectedBoundingBoxForExport(null)}
        />
      ) : null}
    </div>
  );
}
