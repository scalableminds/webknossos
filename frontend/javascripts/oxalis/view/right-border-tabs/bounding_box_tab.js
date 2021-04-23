/**
 * tracing_settings_view.js
 * @flow
 */
import { Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import {
  UserBoundingBoxInput,
  type UserBoundingBoxInputUpdate,
} from "oxalis/view/components/setting_input_views";
import type { OxalisState, Tracing, UserBoundingBox } from "oxalis/store";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { getDatasetExtentInVoxel } from "oxalis/model/accessors/dataset_accessor";
import { setUserBoundingBoxesAction } from "oxalis/model/actions/annotation_actions";
import * as Utils from "libs/utils";

import renderIndependently from "libs/render_independently";
import ExportBoundingBoxModal from "oxalis/view/left-border-tabs/export_bounding_box_modal";

type BoundingBoxTabProps = {
  tracing: Tracing,
  onChangeBoundingBoxes: (value: Array<UserBoundingBox>) => void,
  dataset: APIDataset,
};

function BoundingBoxTab(props: BoundingBoxTabProps) {
  const { tracing, dataset, onChangeBoundingBoxes } = props;
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

  function handleAddNewUserBoundingBox() {
    const datasetBoundingBox = getDatasetExtentInVoxel(dataset);
    // We use the default of -1 to get the id 0 for the first user bounding box.
    const highestBoundingBoxId = Math.max(-1, ...userBoundingBoxes.map(bb => bb.id));
    const boundingBoxId = highestBoundingBoxId + 1;
    const newUserBoundingBox = {
      boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(datasetBoundingBox),
      id: boundingBoxId,
      name: `user bounding box ${boundingBoxId}`,
      color: Utils.getRandomColor(),
      isVisible: true,
    };
    const updatedUserBoundingBoxes = [...userBoundingBoxes, newUserBoundingBox];
    onChangeBoundingBoxes(updatedUserBoundingBoxes);
  }

  function handleDeleteUserBoundingBox(id: number) {
    const updatedUserBoundingBoxes = userBoundingBoxes.filter(boundingBox => boundingBox.id !== id);
    onChangeBoundingBoxes(updatedUserBoundingBoxes);
  }

  function handleExportUserBoundingBox(id: number) {
    const selectedBoundingBox = userBoundingBoxes.find(boundingBox => boundingBox.id === id);
    if (selectedBoundingBox) {
      renderIndependently(destroy => (
        <ExportBoundingBoxModal
          dataset={dataset}
          tracing={tracing}
          boundingBox={selectedBoundingBox.boundingBox}
          destroy={destroy}
        />
      ));
    }
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
            isVisible={bb.isVisible}
            onChange={_.partial(handleChangeUserBoundingBox, bb.id)}
            onDelete={_.partial(handleDeleteUserBoundingBox, bb.id)}
            onExport={_.partial(handleExportUserBoundingBox, bb.id)}
          />
        ))
      ) : (
        <div>No Bounding Boxes created yet.</div>
      )}
      <div style={{ display: "inline-block", width: "100%", textAlign: "center" }}>
        <Tooltip title="Click to add another bounding box.">
          <PlusOutlined
            onClick={handleAddNewUserBoundingBox}
            style={{
              cursor: "pointer",
              marginBottom: userBoundingBoxes.length === 0 ? 12 : 0,
            }}
          />
        </Tooltip>
      </div>
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
});

export default connect<BoundingBoxTabProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(BoundingBoxTab);
