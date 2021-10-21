/**
 * tracing_settings_view.js
 * @flow
 */
import { Tooltip } from "antd";
import { PlusSquareOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { useState } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { type Vector3 } from "oxalis/constants";
import {
  UserBoundingBoxInput,
  type UserBoundingBoxInputUpdate,
} from "oxalis/view/components/setting_input_views";
import type { OxalisState, Tracing, UserBoundingBox } from "oxalis/store";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  setUserBoundingBoxesAction,
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
  setUserBoundingBoxVisibilityAction,
  setUserBoundingBoxNameAction,
  setUserBoundingBoxColorAction,
} from "oxalis/model/actions/annotation_actions";
import * as Utils from "libs/utils";

import ExportBoundingBoxModal from "oxalis/view/right-border-tabs/export_bounding_box_modal";

type BoundingBoxTabProps = {
  tracing: Tracing,
  onChangeBoundingBoxes: (value: Array<UserBoundingBox>) => void,
  addNewBoundingBox: () => void,
  deleteBoundingBox: number => void,
  setBoundingBoxVisibility: (number, boolean) => void,
  setBoundingBoxName: (number, string) => void,
  setBoundingBoxColor: (number, Vector3) => void,
  setPosition: Vector3 => void,
  dataset: APIDataset,
};

function BoundingBoxTab(props: BoundingBoxTabProps) {
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] = useState(null);
  const {
    tracing,
    dataset,
    onChangeBoundingBoxes,
    addNewBoundingBox,
    setBoundingBoxVisibility,
    setBoundingBoxName,
    setBoundingBoxColor,
    deleteBoundingBox,
    setPosition,
  } = props;
  const { userBoundingBoxes } = getSomeTracing(tracing);

  function handleChangeUserBoundingBox(
    id: number,
    { boundingBox, name, color, isVisible }: UserBoundingBoxInputUpdate,
  ) {
    const maybeUpdatedBoundingBox = boundingBox
      ? Utils.computeBoundingBoxFromArray(boundingBox)
      : undefined;

    const updatedUserBoundingBoxes = userBoundingBoxes.map(bb =>
      bb.id === id
        ? {
            ...bb,
            boundingBox: maybeUpdatedBoundingBox || bb.boundingBox,
            name: name != null ? name : bb.name,
            color: color || bb.color,
            isVisible: isVisible != null ? isVisible : bb.isVisible,
          }
        : bb,
    );
    onChangeBoundingBoxes(updatedUserBoundingBoxes);
  }

  function handleBoundingBoxVisibilityChange(id: number, isVisible: boolean) {
    setBoundingBoxVisibility(id, isVisible);
  }

  function handleBoundingBoxNameChange(id: number, name: string) {
    setBoundingBoxName(id, name);
  }

  function handleBoundingBoxColorChange(id: number, color: Vector3) {
    setBoundingBoxColor(id, color);
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

  function handleAddNewUserBoundingBox() {
    addNewBoundingBox();
  }

  function handleDeleteUserBoundingBox(id: number) {
    deleteBoundingBox(id);
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
            onChange={_.partial(handleChangeUserBoundingBox, bb.id)}
            onDelete={_.partial(handleDeleteUserBoundingBox, bb.id)}
            onExport={
              dataset.jobsEnabled ? _.partial(setSelectedBoundingBoxForExport, bb) : () => {}
            }
            onGoToBoundingBox={_.partial(handleGoToBoundingBox, bb.id)}
            onVisibilityChange={_.partial(handleBoundingBoxVisibilityChange, bb.id)}
            onNameChange={_.partial(handleBoundingBoxNameChange, bb.id)}
            onColorChange={_.partial(handleBoundingBoxColorChange, bb.id)}
          />
        ))
      ) : (
        <div>No Bounding Boxes created yet.</div>
      )}
      <div style={{ display: "inline-block", width: "100%", textAlign: "center" }}>
        <Tooltip title="Click to add another bounding box.">
          <PlusSquareOutlined
            onClick={handleAddNewUserBoundingBox}
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

const mapStateToProps = (state: OxalisState) => ({
  tracing: state.tracing,
  dataset: state.dataset,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeBoundingBoxes(userBoundingBoxes: Array<UserBoundingBox>) {
    dispatch(setUserBoundingBoxesAction(userBoundingBoxes));
  },
  addNewBoundingBox() {
    dispatch(addUserBoundingBoxAction());
  },
  setPosition(position: Vector3) {
    dispatch(setPositionAction(position));
  },
  deleteBoundingBox(id: number) {
    dispatch(deleteUserBoundingBoxAction(id));
  },
  setBoundingBoxVisibility(id: number, isVisible: boolean) {
    dispatch(setUserBoundingBoxVisibilityAction(id, isVisible));
  },
  setBoundingBoxName(id: number, name: string) {
    dispatch(setUserBoundingBoxNameAction(id, name));
  },
  setBoundingBoxColor(id: number, color: Vector3) {
    dispatch(setUserBoundingBoxColorAction(id, color));
  },
});

export default connect<BoundingBoxTabProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(BoundingBoxTab);
