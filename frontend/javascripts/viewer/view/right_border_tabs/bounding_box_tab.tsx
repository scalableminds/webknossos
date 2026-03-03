import { DeleteOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Divider, type MenuProps, Space, Table, type TableProps, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox, computeBoundingBoxFromArray } from "libs/utils";
import noop from "lodash-es/noop";
import partial from "lodash-es/partial";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { APIJobCommand } from "types/api_types";
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
import DownloadModalView from "../action_bar/download_modal_view";
import ButtonComponent from "../components/button_component";
import { getContextMenuPositionFromEvent } from "../context_menu";
import AdvancedSearchPopover from "./advanced_search_popover";
import { ContextMenuContainer } from "./sidebar_context_menu";

const BBOX_BUTTONS_HEADER_HEIGHT = 40;
const CONTEXT_MENU_CLASS = "bbox-list-context-menu-overlay";
const BOUNDING_BOX_TAB_ID = "bounding-box-tab";

export default function BoundingBoxTab() {
  const bboxTableRef: Parameters<typeof Table>[0]["ref"] = useRef(null);
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] =
    useState<UserBoundingBox | null>(null);
  const annotation = useWkSelector((state) => state.annotation);
  const allowUpdate = annotation.isUpdatingCurrentlyAllowed;
  const isLockedByOwner = annotation.isLockedByOwner;
  const isOwner = useWkSelector((state) => isAnnotationOwner(state));
  const dataset = useWkSelector((state) => state.dataset);
  const activeBoundingBoxId = useWkSelector((state) => state.uiInformation.activeUserBoundingBoxId);
  const { userBoundingBoxes } = getSomeTracing(annotation);
  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [menu, setMenu] = useState<MenuProps | null>(null);
  const dispatch = useDispatch();

  const setChangeBoundingBoxBounds = useCallback(
    (id: number, boundingBox: BoundingBoxMinMaxType) =>
      dispatch(
        changeUserBoundingBoxAction(id, {
          boundingBox,
        }),
      ),
    [dispatch],
  );

  const addNewBoundingBox = useCallback(() => dispatch(addUserBoundingBoxAction()), [dispatch]);

  const setPosition = useCallback(
    (position: Vector3) => dispatch(setPositionAction(position)),
    [dispatch],
  );

  const hideContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    setMenu(null);
  }, []);

  const deleteBoundingBox = (id: number) => {
    dispatch(deleteUserBoundingBoxAction(id));
    hideContextMenu();
    // In case the deleted bounding box was selected (alone or with others), remove it from the selection.
    setSelectedRowKeys(() => selectedRowKeys.filter((key) => key !== id));
  };

  const deleteSelectedBoundingBoxes = useCallback(() => {
    selectedRowKeys.forEach((bboxId) => {
      dispatch(deleteUserBoundingBoxAction(bboxId));
    });
    setSelectedRowKeys([]);
    hideContextMenu();
  }, [dispatch, selectedRowKeys, hideContextMenu]);

  const setBoundingBoxVisibility = useCallback(
    (id: number, isVisible: boolean) =>
      dispatch(
        changeUserBoundingBoxAction(id, {
          isVisible,
        }),
      ),
    [dispatch],
  );

  const setBoundingBoxName = useCallback(
    (id: number, name: string) =>
      dispatch(
        changeUserBoundingBoxAction(id, {
          name,
        }),
      ),
    [dispatch],
  );

  const setBoundingBoxColor = useCallback(
    (id: number, color: Vector3) =>
      dispatch(
        changeUserBoundingBoxAction(id, {
          color,
        }),
      ),
    [dispatch],
  );

  const handleBoundingBoxBoundingChange = useCallback(
    (id: number, boundingBox: Vector6) => {
      setChangeBoundingBoxBounds(id, computeBoundingBoxFromArray(boundingBox));
    },
    [setChangeBoundingBoxBounds],
  );

  const handleExportBoundingBox = useCallback(
    (bb: UserBoundingBox) => {
      setSelectedBoundingBoxForExport(bb);
      hideContextMenu();
    },
    [hideContextMenu],
  );

  const handleGoToBoundingBox = useCallback(
    (id: number) => {
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
    },
    [userBoundingBoxes, setPosition, hideContextMenu],
  );

  const handleSelectAllMatchingBoundingBoxes = useCallback(
    (matchingBoundingBoxes: UserBoundingBox[]) => {
      if (matchingBoundingBoxes.length === 0) {
        return;
      }
      const matchingBoundingBoxIds = matchingBoundingBoxes.map((boundingBox) => boundingBox.id);
      const firstMatchingBoundingBoxId = matchingBoundingBoxIds[0];
      setSelectedRowKeys(matchingBoundingBoxIds);
      handleGoToBoundingBox(firstMatchingBoundingBoxId);
      dispatch(setActiveUserBoundingBoxId(firstMatchingBoundingBoxId));
    },
    [dispatch, handleGoToBoundingBox],
  );

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
    APIJobCommand.EXPORT_TIFF,
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
          bboxId={bb.id}
          value={computeArrayFromBoundingBox(bb.boundingBox)}
          color={bb.color}
          name={bb.name}
          isExportEnabled={isExportEnabled}
          isVisible={bb.isVisible}
          onBoundingChange={partial(handleBoundingBoxBoundingChange, bb.id)}
          onDelete={partial(deleteBoundingBox, bb.id)}
          onExport={isExportEnabled ? () => handleExportBoundingBox(bb) : noop}
          onGoToBoundingBox={partial(handleGoToBoundingBox, bb.id)}
          onVisibilityChange={partial(setBoundingBoxVisibility, bb.id)}
          onNameChange={partial(setBoundingBoxName, bb.id)}
          onColorChange={partial(setBoundingBoxColor, bb.id)}
          disabled={!allowUpdate}
          isLockedByOwner={isLockedByOwner}
          isOwner={isOwner}
          onOpenContextMenu={(menu, event) => onOpenContextMenu(menu, event, bb.id)}
          onHideContextMenu={hideContextMenu}
        />
      ),
    },
  ];

  const getPropsForRow = useCallback<NonNullable<TableProps<UserBoundingBox>["onRow"]>>(
    (bb: UserBoundingBox) => ({
      onClick: (event) => {
        hideContextMenu();
        if (event.ctrlKey || event.metaKey) {
          setSelectedRowKeys((prev) =>
            prev.includes(bb.id) ? prev.filter((key) => key !== bb.id) : [...prev, bb.id],
          );
        } else {
          handleGoToBoundingBox(bb.id);
          setSelectedRowKeys([bb.id]);
          dispatch(setActiveUserBoundingBoxId(bb.id));
        }
      },
    }),
    [hideContextMenu, dispatch, handleGoToBoundingBox],
  );

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

  return (
    <div
      id={BOUNDING_BOX_TAB_ID}
      className="padded-tab-content"
      style={{
        minWidth: 300,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Space>
        <AdvancedSearchPopover
          data={userBoundingBoxes}
          onSelect={(boundingBox: UserBoundingBox) => {
            handleGoToBoundingBox(boundingBox.id);
            setSelectedRowKeys([boundingBox.id]);
            dispatch(setActiveUserBoundingBoxId(boundingBox.id));
          }}
          onSelectAllMatches={handleSelectAllMatchingBoundingBoxes}
          searchKey="name"
          provideShortcut
          targetId={BOUNDING_BOX_TAB_ID}
        >
          <ButtonComponent
            icon={<SearchOutlined />}
            title="Open search via CTRL + Shift + F"
            variant="text"
            color="default"
          />
        </AdvancedSearchPopover>
        <ButtonComponent
          disabled={!allowUpdate}
          variant="text"
          color="default"
          title="Click to add another bounding box."
          onClick={addNewBoundingBox}
          icon={<PlusOutlined />}
        />
        <ButtonComponent
          disabled={!allowUpdate || selectedRowKeys.length === 0}
          variant="text"
          color="default"
          title={
            selectedRowKeys.length > 1
              ? `Delete ${selectedRowKeys.length} selected bounding boxes`
              : "Delete selected bounding box"
          }
          onClick={deleteSelectedBoundingBoxes}
          icon={<DeleteOutlined />}
        />
      </Space>
      <Divider size="small" />
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={menu}
        className={CONTEXT_MENU_CLASS}
      />
      {/* Don't render a table in view mode. */}
      {isViewMode ? null : (
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
                locale={{ emptyText: "No Bounding Boxes created yet." }}
                rowSelection={{
                  selectedRowKeys,
                  getCheckboxProps: () => ({ disabled: true }),
                }}
                virtual
                scroll={{ y: height - BBOX_BUTTONS_HEADER_HEIGHT }} // If the scroll height is exactly
                // the height of the diff, the AutoSizer will always rerender the table and toggle an additional scrollbar.
                onRow={getPropsForRow}
              />
            </div>
          )}
        </AutoSizer>
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
