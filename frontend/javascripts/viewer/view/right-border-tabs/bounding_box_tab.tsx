import { PlusSquareOutlined } from "@ant-design/icons";
import { type MenuProps, Table, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import * as Utils from "libs/utils";
import _ from "lodash";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { APIJobType } from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import { ControlModeEnum, type Vector3, type Vector6 } from "viewer/constants";
import { isAnnotationOwner } from "viewer/model/accessors/annotation_accessor";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import UserBoundingBoxInput from "viewer/view/components/setting_input_views";
import DownloadModalView from "../action-bar/download_modal_view";
import { getContextMenuPositionFromEvent } from "../context_menu";
import { ContextMenuContainer } from "./sidebar_context_menu";

const ADD_BBOX_BUTTON_HEIGHT = 32;
const CONTEXT_MENU_CLASS = "bbox-list-context-menu-overlay";

export default function BoundingBoxTab() {
  const bboxTableRef: Parameters<typeof Table>[0]["ref"] = useRef(null);
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] =
    useState<UserBoundingBox | null>(null);
  const annotation = useWkSelector((state) => state.annotation);
  const allowUpdate = annotation.restrictions.allowUpdate;
  const isLockedByOwner = annotation.isLockedByOwner;
  const isOwner = useWkSelector((state) => isAnnotationOwner(state));
  const dataset = useWkSelector((state) => state.dataset);
  const activeBoundingBoxId = useWkSelector((state) => state.uiInformation.activeUserBoundingBoxId);
  const { userBoundingBoxes } = getSomeTracing(annotation);
  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [menu, setMenu] = useState<MenuProps | null>(null);
  const dispatch = useDispatch();

  const setChangeBoundingBoxBounds = (id: number, boundingBox: BoundingBoxMinMaxType) =>
    dispatch(
      changeUserBoundingBoxAction(id, {
        boundingBox,
      }),
    );

  const addNewBoundingBox = () => dispatch(addUserBoundingBoxAction());

  const setPosition = (position: Vector3) => dispatch(setPositionAction(position));

  const deleteBoundingBox = (id: number) => {
    dispatch(deleteUserBoundingBoxAction(id));
    hideContextMenu();
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

  function handleExportBoundingBox(bb: UserBoundingBox) {
    setSelectedBoundingBoxForExport(bb);
    hideContextMenu();
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
    hideContextMenu();
  }

  const isViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
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

  useEffect(() => {
    if (bboxTableRef.current != null && activeBoundingBoxId != null) {
      bboxTableRef.current.scrollTo({ key: activeBoundingBoxId });
    }
  }, [activeBoundingBoxId]);

  const boundingBoxWrapperTableColumns = [
    {
      title: "Bounding Boxes",
      key: "id",
      render: (_id: number, bb: UserBoundingBox) => (
        <UserBoundingBoxInput
          key={bb.id}
          value={Utils.computeArrayFromBoundingBox(bb.boundingBox)}
          color={bb.color}
          name={bb.name}
          isExportEnabled={isExportEnabled}
          isVisible={bb.isVisible}
          onBoundingChange={_.partial(handleBoundingBoxBoundingChange, bb.id)}
          onDelete={_.partial(deleteBoundingBox, bb.id)}
          onExport={isExportEnabled ? () => handleExportBoundingBox(bb) : _.noop}
          onGoToBoundingBox={_.partial(handleGoToBoundingBox, bb.id)}
          onVisibilityChange={_.partial(setBoundingBoxVisibility, bb.id)}
          onNameChange={_.partial(setBoundingBoxName, bb.id)}
          onColorChange={_.partial(setBoundingBoxColor, bb.id)}
          disabled={!allowUpdate}
          isLockedByOwner={isLockedByOwner}
          isOwner={isOwner}
          onOpenContextMenu={onOpenContextMenu}
          onHideContextMenu={hideContextMenu}
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

  const onOpenContextMenu = (menu: MenuProps, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent that the bounding box gets activated when the context menu is opened.

    const [x, y] = getContextMenuPositionFromEvent(event, CONTEXT_MENU_CLASS);
    showContextMenuAt(x, y, menu);
  };

  const showContextMenuAt = useCallback((xPos: number, yPos: number, menu: MenuProps) => {
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update to delay that the context menu is rendered.
    // Thus the context overlay does not get the right click as an event and therefore does not close.
    setTimeout(() => {
      setContextMenuPosition([xPos, yPos]);
      setMenu(menu);
    }, 0);
  }, []);

  const hideContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    setMenu(null);
  }, []);

  return (
    <div
      className="padded-tab-content"
      style={{
        minWidth: 300,
        height: "100%",
      }}
    >
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={menu}
        className={CONTEXT_MENU_CLASS}
      />
      {/* Don't render a table in view mode. */}
      {isViewMode ? null : userBoundingBoxes.length > 0 ? (
        <AutoSizer defaultHeight={500}>
          {({ height, width }) => (
            <div
              style={{
                height,
                width,
              }}
            >
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
                virtual
                scroll={{ y: height - (allowUpdate ? ADD_BBOX_BUTTON_HEIGHT : 10) }} // If the scroll height is exactly
                // the height of the diff, the AutoSizer will always rerender the table and toggle an additional scrollbar.
                onRow={(bb) => ({
                  onClick: () => {
                    hideContextMenu();
                    handleGoToBoundingBox(bb.id);
                    dispatch(setActiveUserBoundingBoxId(bb.id));
                  },
                })}
              />
            </div>
          )}
        </AutoSizer>
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
