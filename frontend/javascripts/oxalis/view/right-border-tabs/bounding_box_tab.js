// @flow
import { Button, Form, Modal, Tooltip } from "antd";
import { PlusSquareOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import React, { useState } from "react";
import _ from "lodash";

import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import { UserBoundingBoxInput } from "oxalis/view/components/setting_input_views";
import type { Vector3, Vector6, BoundingBoxType } from "oxalis/constants";
import {
  changeUserBoundingBoxAction,
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "oxalis/model/actions/annotation_actions";
import { getActiveSegmentationTracingLayer } from "oxalis/model/accessors/volumetracing_accessor";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { startGlobalizeFloodfillsJob } from "admin/admin_rest_api";
import ExportBoundingBoxModal from "oxalis/view/right-border-tabs/export_bounding_box_modal";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import features from "features";

const GLOBALIZE_FLOODFILL_REGEX = /Limits of flood-fill \(source_id=(\d+), target_id=(\d+), seed=([\d,]+), timestamp=(\d+)\)/;

function StartGlobalizeFloodfillsModal({
  onStartGlobalization,
  handleClose,
  activeUser,
  initialName,
}) {
  const handleSubmit = async formValues => {
    try {
      await onStartGlobalization(formValues.name);
      handleClose();
    } catch (exception) {
      Toast.info(
        <React.Fragment>
          The globilization of the floodfill operation(s) could not be started. Open the browser
          console for more details.
        </React.Fragment>,
      );
      console.error(exception);
      return;
    }

    Toast.info(
      <React.Fragment>
        The globilization of the floodfill operation(s) has been started. For large datasets, this
        may take a while. Closing this tab will not stop the computation.
        <br />
        See{" "}
        <a target="_blank" href="/jobs" rel="noopener noreferrer">
          Processing Jobs
        </a>{" "}
        for an overview of running jobs.
      </React.Fragment>,
    );
  };

  return (
    <Modal title="Globalize Floodfills" onCancel={handleClose} visible width={500} footer={null}>
      <p>
        For this annotation some floodfill operations were aborted prematurely, because they covered
        a too large volume. webKnossos can finish these operations via a long-running job. This job
        will copy the current dataset, apply the changes of the current volume annotation into the
        volume layer and use the existing bounding boxes as seeds to continue the remaining
        floodfill operations (i.e., &quot;globalize&quot; them).
      </p>

      <Form
        onFinish={handleSubmit}
        layout="vertical"
        initialValues={{ initialTeams: [], scale: [0, 0, 0], zipFile: [] }}
      >
        <DatasetNameFormItem activeUser={activeUser} initialName={initialName} />

        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <Button size="large" type="primary" htmlType="submit">
            Globalize Floodfills
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

export default function BoundingBoxTab() {
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] = useState(null);
  const [isGlobalizeFloodfillsModalVisible, setIsGlobalizeFloodfillsModalVisible] = useState(false);

  const tracing = useSelector(state => state.tracing);
  const dataset = useSelector(state => state.dataset);
  const activeUser = useSelector(state => state.activeUser);
  const activeSegmentationTracingLayer = useSelector(getActiveSegmentationTracingLayer);
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

  const showGlobalizeFloodfillsButton =
    features().jobsEnabled &&
    activeUser != null &&
    activeSegmentationTracingLayer != null &&
    userBoundingBoxes.some(bbox => bbox.name.match(GLOBALIZE_FLOODFILL_REGEX) != null);

  const onGlobalizeFloodfills = newName => {
    if (activeSegmentationTracingLayer == null) {
      return;
    }
    const baseSegmentationName = getBaseSegmentationName(activeSegmentationTracingLayer);
    startGlobalizeFloodfillsJob(
      dataset.owningOrganization,
      dataset.name,
      newName,
      baseSegmentationName,
      tracing.annotationId,
      tracing.annotationType,
    );
  };
  return (
    <div className="padded-tab-content" style={{ minWidth: 300 }}>
      {showGlobalizeFloodfillsButton ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Tooltip title="For this annotation some floodfill operations were aborted prematurely, because they covered a too large volume. webKnossos can finish these operations via a long-running job.">
            <Button
              size="small"
              style={{ marginBottom: 8 }}
              onClick={() => setIsGlobalizeFloodfillsModalVisible(true)}
            >
              <i className="fas fa-fill-drip" />
              Globalize Flood-Fills
            </Button>
          </Tooltip>
        </div>
      ) : null}
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
      {isGlobalizeFloodfillsModalVisible ? (
        <StartGlobalizeFloodfillsModal
          onStartGlobalization={onGlobalizeFloodfills}
          activeUser={activeUser}
          handleClose={() => setIsGlobalizeFloodfillsModalVisible(false)}
          initialName={`${dataset.name}_with_floodfills`}
        />
      ) : null}
    </div>
  );
}
