import { Table, Tooltip, Typography } from "antd";
import { PlusSquareOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import React, { useEffect, useRef, useState } from "react";
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
import { api } from "oxalis/singletons";
import features from "features";
import Toast from "libs/toast";

export default function BoundingBoxTab() {
  const bboxTableRef: Parameters<typeof Table>[0]["ref"] = useRef(null);
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] =
    useState<UserBoundingBox | null>(null);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const allowUpdate = tracing.restrictions.allowUpdate;
  const isLockedByOwner = tracing.isLockedByOwner;
  const isOwner = useSelector((state: OxalisState) => isAnnotationOwner(state));
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const activeBoundingBoxId = useSelector(
    (state: OxalisState) => state.uiInformation.activeUserBoundingBoxId,
  );
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

  const registerSegmentsForBoundingBox = async (min: Vector3, max: Vector3) => {
    const shape = Utils.computeShapeFromBoundingBox({ min, max });
    const mag = [1, 1, 1];
    const volume =
      Math.ceil(shape[0] / mag[0]) * Math.ceil(shape[1] / mag[1]) * Math.ceil(shape[2] / mag[2]); // TODO_c later
    const maxVolume = features().exportTiffMaxVolumeMVx * 1024 * 1024;
    console.log(volume, maxVolume);
    if (volume > maxVolume) {
      Toast.error(
        "The volume of the bounding box is too large, please reduce the size of the bounding box.",
      );
      return;
    } else if (volume > maxVolume / 8) {
      Toast.warning(
        "The volume of the bounding box is very large, registering all segments might take a while.",
      );
    }

    const segmentationLayerName = api.data.getSegmentationLayerNames()[0];
    // TODO getDataForBoundingBox takes mag1 bbs. what about other mags?
    const data = await api.data.getDataForBoundingBox(segmentationLayerName, {
      min,
      max,
    });

    const segmentIdToPosition = new Map();
    let idx = 0;
    for (let z = min[2]; z < max[2]; z++) {
      for (let y = min[1]; y < max[1]; y++) {
        for (let x = min[0]; x < max[0]; x++) {
          const id = data[idx];
          if (!segmentIdToPosition.has(id)) {
            segmentIdToPosition.set(id, [x, y, z]);
          }
          idx++;
        }
      }
    }

    const segmentIds = Array.from(segmentIdToPosition.entries());
    console.log(segmentIds.length);
    if (segmentIds.length > 2000) {
      Toast.error(
        "The bounding box contains more than 2000 segments. Please reduce the size of the bounding box.",
      );
      return;
    } else if (segmentIds.length > 1000) {
      Toast.warning(
        "The bounding box contains more than 1000 segments. Registering all segments might take a while.",
      );
    }

    for (const [id, position] of segmentIdToPosition.entries()) {
      api.tracing.registerSegment(id, position, undefined, segmentationLayerName);
    }
  };

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Always try to scroll the active bounding box into view.
  useEffect(() => {
    if (bboxTableRef.current != null && activeBoundingBoxId != null) {
      bboxTableRef.current.scrollTo({ key: activeBoundingBoxId });
    }
  }, [activeBoundingBoxId, bboxTableRef.current]);

  const boundingBoxWrapperTableColumns = [
    {
      title: "Bounding Boxes",
      key: "id",
      render: (_id: number, bb: UserBoundingBox) => (
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
          onRegisterSegmentsForBB={registerSegmentsForBoundingBox}
          onGoToBoundingBox={_.partial(handleGoToBoundingBox, bb.id)}
          onVisibilityChange={_.partial(setBoundingBoxVisibility, bb.id)}
          onNameChange={_.partial(setBoundingBoxName, bb.id)}
          onColorChange={_.partial(setBoundingBoxColor, bb.id)}
          disabled={!allowUpdate}
          isLockedByOwner={isLockedByOwner}
          isOwner={isOwner}
        />
      ),
    },
  ];

  const maybeAddBoundingBoxButton = allowUpdate ? (
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
  ) : null;

  return (
    <div
      className="padded-tab-content"
      style={{
        minWidth: 300,
      }}
    >
      {/* Don't render a table in view mode. */}
      {isViewMode ? null : userBoundingBoxes.length > 0 ? (
        <Table
          ref={bboxTableRef}
          columns={boundingBoxWrapperTableColumns}
          dataSource={userBoundingBoxes}
          pagination={false}
          rowKey="id"
          showHeader={false}
          className="bounding-box-table"
          rowSelection={{
            selectedRowKeys: activeBoundingBoxId != null ? [activeBoundingBoxId] : [],
            getCheckboxProps: () => ({ disabled: true }),
          }}
          footer={() => maybeAddBoundingBoxButton}
        />
      ) : (
        <>
          <div>No Bounding Boxes created yet.</div>
          {maybeAddBoundingBoxButton}
        </>
      )}
      <Typography.Text type="secondary">{maybeUneditableExplanation}</Typography.Text>
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
