import {
  AppstoreAddOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import MipIcon from "@images/icons/icon-mip.svg?react";
import {
  Divider,
  Empty,
  Flex,
  type MenuProps,
  Popover,
  Slider,
  Space,
  Switch,
  Table,
  type TableProps,
  Typography,
} from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import {
  computeArrayFromBoundingBox,
  computeBoundingBoxFromArray,
  stringToColor,
} from "libs/utils";
import noop from "lodash-es/noop";
import partial from "lodash-es/partial";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { APIJobCommand } from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import { ControlModeEnum, type Vector3, type Vector6 } from "viewer/constants";
import { isAnnotationOwner } from "viewer/model/accessors/annotation_accessor";
import {
  getDataLayers,
  getLayerBoundingBox,
  getLayerBoundingBoxId,
} from "viewer/model/accessors/dataset_accessor";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import {
  setLayerBoundingBoxColorAction,
  setLayerBoundingBoxVisibilityAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import DownloadModalView from "../action_bar/download_modal/download_modal_view";
import ButtonComponent from "../components/button_component";
import { getContextMenuPositionFromEvent } from "../context_menu/helpers";
import UserBoundingBoxInput from "../left_border_tabs/components/user_boundingbox_input";
import AdvancedSearchPopover from "./advanced_search_popover";
import GenerateBoundingBoxesModal from "./generate_bounding_boxes_modal";
import { ContextMenuContainer } from "./sidebar_context_menu";

const BBOX_BUTTONS_HEADER_HEIGHT = 40;
const CONTEXT_MENU_CLASS = "bbox-list-context-menu-overlay";
const BOUNDING_BOX_TAB_ID = "bounding-box-tab";
// If there are at least this many user bounding boxes, the layer bounding box section is collapsed by
// default (unless the user manually toggled it) to avoid pushing the user bounding boxes out of view.
const COLLAPSE_LAYER_SECTION_BBOX_THRESHOLD = 10;

type LayerBoundingBox = {
  // The technical layer name, used as a stable key for display state (color/visibility) and rendering.
  name: string;
  // The human-readable name shown to the user. For volume tracing layers, the technical name is an
  // opaque id, so a dedicated readable name is resolved via getReadableNameForLayerName.
  displayName: string;
  value: Vector6;
  center: Vector3;
  // Stable per-layer id (see getLayerBoundingBoxId), used to key per-bbox settings such as MIP.
  id: number;
};

export default function BoundingBoxTab() {
  const bboxTableRef: Parameters<typeof Table>[0]["ref"] = useRef(null);
  const [selectedBoundingBoxForExport, setSelectedBoundingBoxForExport] =
    useState<UserBoundingBox | null>(null);
  const [selectedLayerForExport, setSelectedLayerForExport] = useState<string | null>(null);
  const annotation = useWkSelector((state) => state.annotation);
  const allowUpdate = useWkSelector((state) => state.annotation.isUpdatingCurrentlyAllowed);
  const isLockedByOwner = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector((state) => isAnnotationOwner(state));
  const dataset = useWkSelector((state) => state.dataset);
  const activeBoundingBoxId = useWkSelector((state) => state.uiInformation.activeUserBoundingBoxId);
  // Select the bounding boxes directly (instead of the whole annotation) so that
  // this tab only re-renders when the boxes actually change.
  const userBoundingBoxes = useWkSelector(
    (state) => getSomeTracing(state.annotation).userBoundingBoxes,
  );
  const layerBoundingBoxVisibilities = useWkSelector(
    (state) => state.temporaryConfiguration.layerBoundingBoxVisibilities,
  );
  const layerBoundingBoxColors = useWkSelector(
    (state) => state.temporaryConfiguration.layerBoundingBoxColors,
  );
  const layerBoundingBoxes = useMemo<LayerBoundingBox[]>(
    () =>
      getDataLayers(dataset).map((layer, index) => {
        const boundingBox = getLayerBoundingBox(dataset, layer.name);
        return {
          name: layer.name,
          displayName: getReadableNameForLayerName(dataset, annotation, layer.name),
          value: computeArrayFromBoundingBox(boundingBox),
          center: boundingBox.getCenter(),
          id: getLayerBoundingBoxId(index),
        };
      }),
    [dataset, annotation],
  );
  const mipRaymarchingSteps = useWkSelector((state) => state.userConfiguration.mipRaymarchingSteps);
  const mipDepthWrite = useWkSelector((state) => state.userConfiguration.mipDepthWrite);
  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [menu, setMenu] = useState<MenuProps | null>(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  // null => automatic (collapsed once there are many user bounding boxes); a boolean is a manual override.
  // Keeping the default as null (instead of eagerly computing the collapsed state once) means the
  // section keeps following the bbox count until the user explicitly toggles it: e.g. if the user
  // never touches it and then keeps adding bounding boxes, the section auto-collapses as soon as the
  // threshold is crossed — behaviour a fixed initial boolean could not provide.
  const [isLayerSectionCollapsedOverride, setIsLayerSectionCollapsedOverride] = useState<
    boolean | null
  >(null);
  const dispatch = useDispatch();

  const isLayerSectionCollapsed =
    isLayerSectionCollapsedOverride ??
    userBoundingBoxes.length >= COLLAPSE_LAYER_SECTION_BBOX_THRESHOLD;

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

  const handleGoToLayerBoundingBox = useCallback(
    (center: Vector3) => {
      setPosition(center);
      hideContextMenu();
    },
    [setPosition, hideContextMenu],
  );

  const handleExportLayerBoundingBox = useCallback(
    (layerName: string) => {
      setSelectedLayerForExport(layerName);
      hideContextMenu();
    },
    [hideContextMenu],
  );

  const setLayerBoundingBoxVisibility = useCallback(
    (layerName: string, isVisible: boolean) =>
      dispatch(setLayerBoundingBoxVisibilityAction(layerName, isVisible)),
    [dispatch],
  );

  const setLayerBoundingBoxColor = useCallback(
    (layerName: string, color: Vector3) =>
      dispatch(setLayerBoundingBoxColorAction(layerName, color)),
    [dispatch],
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

  const userBoundingBoxColumns: NonNullable<TableProps<UserBoundingBox>["columns"]> = [
    {
      title: "Bounding Boxes",
      key: "id",
      render: (_key: unknown, bb: UserBoundingBox) => (
        <UserBoundingBoxInput
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
          onOpenContextMenu={(menu, event) => onOpenContextMenu(menu, event)}
          onHideContextMenu={hideContextMenu}
        />
      ),
    },
  ];

  const layerBoundingBoxColumns: NonNullable<TableProps<LayerBoundingBox>["columns"]> = [
    {
      title: "Layer Bounding Boxes",
      key: "name",
      render: (_key: unknown, layerBoundingBox: LayerBoundingBox) => (
        <UserBoundingBoxInput
          bboxId={layerBoundingBox.id}
          value={layerBoundingBox.value}
          name={layerBoundingBox.displayName}
          color={
            layerBoundingBoxColors[layerBoundingBox.name] ?? stringToColor(layerBoundingBox.name)
          }
          isVisible={layerBoundingBoxVisibilities[layerBoundingBox.name] ?? false}
          isExportEnabled={isExportEnabled}
          isReadOnly
          // Registering segments modifies the annotation, so it is only possible when updating is allowed.
          disabled={!allowUpdate}
          onExport={
            isExportEnabled ? () => handleExportLayerBoundingBox(layerBoundingBox.name) : noop
          }
          onGoToBoundingBox={() => handleGoToLayerBoundingBox(layerBoundingBox.center)}
          onVisibilityChange={partial(setLayerBoundingBoxVisibility, layerBoundingBox.name)}
          onColorChange={partial(setLayerBoundingBoxColor, layerBoundingBox.name)}
          onOpenContextMenu={(menu, event) => onOpenContextMenu(menu, event)}
          onHideContextMenu={hideContextMenu}
        />
      ),
    },
  ];

  const getPropsForUserRow = useCallback<NonNullable<TableProps<UserBoundingBox>["onRow"]>>(
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

  const getPropsForLayerRow = useCallback<NonNullable<TableProps<LayerBoundingBox>["onRow"]>>(
    (layerBoundingBox: LayerBoundingBox) => ({
      onClick: () => {
        // Read-only layer bounding boxes cannot be selected, but clicking still navigates to them.
        hideContextMenu();
        handleGoToLayerBoundingBox(layerBoundingBox.center);
      },
    }),
    [hideContextMenu, handleGoToLayerBoundingBox],
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
        display: "flex",
        flexDirection: "column",
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
          disabled={!allowUpdate}
          variant="text"
          color="default"
          title="Generate bounding boxes randomly distributed across the dataset."
          onClick={() => setIsGenerateModalOpen(true)}
          icon={<AppstoreAddOutlined />}
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
        <Popover
          title="Maximum Intensity Projection (MIP) Settings"
          trigger="click"
          content={
            <div style={{ width: 260 }}>
              <div style={{ marginBottom: 4 }}>
                Ray marching steps{" "}
                <FastTooltip title="Number of samples taken along each ray. Higher values produce a smoother, more accurate projection at the cost of GPU performance.">
                  <InfoCircleOutlined />
                </FastTooltip>
              </div>
              <Flex gap="small" align="center">
                <Slider
                  style={{ flex: 1 }}
                  min={16}
                  max={512}
                  step={16}
                  value={mipRaymarchingSteps}
                  onChange={(v) => dispatch(updateUserSettingAction("mipRaymarchingSteps", v))}
                />
                <span style={{ width: 30, textAlign: "right" }}>{mipRaymarchingSteps}</span>
              </Flex>
              <Flex gap="small" align="center" style={{ marginTop: 8 }}>
                <Switch
                  size="small"
                  checked={mipDepthWrite}
                  onChange={(v) => dispatch(updateUserSettingAction("mipDepthWrite", v))}
                />
                <span>Depth-correct rendering</span>
                <FastTooltip title="Lets MIP volumes occlude and be occluded by meshes correctly. Disable for better performance if depth sorting with meshes is not needed.">
                  <InfoCircleOutlined />
                </FastTooltip>
              </Flex>
            </div>
          }
        >
          <ButtonComponent
            variant="text"
            color="default"
            title="Maximum Intensity Projection (MIP) rendering settings"
            icon={<MipIcon />}
          />
        </Popover>
      </Space>
      <Divider size="small" />
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={menu}
        className={CONTEXT_MENU_CLASS}
      />
      {/* Editable user bounding boxes. Hidden in view mode when there are none (nothing to add). */}
      {userBoundingBoxes.length > 0 || !isViewMode ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <AutoSizer defaultHeight={500}>
            {({ height, width }) => (
              <div style={{ height, width }}>
                {userBoundingBoxes.length === 0 ? (
                  <Flex justify="center">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="There are no bounding boxes yet. Add one with the + button, draw one with the bounding box tool, or generate several at once."
                    />
                  </Flex>
                ) : (
                  <Table
                    ref={bboxTableRef}
                    columns={userBoundingBoxColumns}
                    dataSource={userBoundingBoxes}
                    pagination={false}
                    rowKey="id"
                    showHeader={false}
                    className="bounding-box-table"
                    rowSelection={{
                      selectedRowKeys,
                      getCheckboxProps: () => ({ disabled: true }),
                    }}
                    virtual
                    scroll={{ y: height - BBOX_BUTTONS_HEADER_HEIGHT }} // If the scroll height is exactly
                    // the height of the diff, the AutoSizer will always rerender the table and toggle an additional scrollbar.
                    onRow={getPropsForUserRow}
                  />
                )}
              </div>
            )}
          </AutoSizer>
        </div>
      ) : null}
      {/* Read-only bounding boxes of the dataset's layers. */}
      {layerBoundingBoxes.length > 0 ? (
        <Flex
          vertical
          style={{
            flexShrink: 0,
            marginTop: 8,
            minHeight: 0,
          }}
        >
          <Divider size="small" titlePlacement="left" style={{ margin: "4px 0" }}>
            <FastTooltip title="These are the read-only bounding boxes of the dataset's layers. Click to collapse or expand.">
              <span
                onClick={() => setIsLayerSectionCollapsedOverride(!isLayerSectionCollapsed)}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                {isLayerSectionCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />} Layer
                Bounding Boxes
              </span>
            </FastTooltip>
          </Divider>
          {isLayerSectionCollapsed ? null : (
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              <Table
                columns={layerBoundingBoxColumns}
                dataSource={layerBoundingBoxes}
                pagination={false}
                rowKey="name"
                showHeader={false}
                className="bounding-box-table"
                // The shared .bounding-box-table styling hides the (selection) first column and expects
                // the content in the second one, so the layer table needs the same disabled selection column.
                rowSelection={{ getCheckboxProps: () => ({ disabled: true }) }}
                onRow={getPropsForLayerRow}
              />
            </div>
          )}
        </Flex>
      ) : null}
      <Typography.Text type="secondary">{maybeUneditableExplanation}</Typography.Text>
      {isGenerateModalOpen ? (
        <GenerateBoundingBoxesModal
          isOpen={isGenerateModalOpen}
          onClose={() => setIsGenerateModalOpen(false)}
          magnification={null}
          jobType={null}
        />
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
      {selectedLayerForExport != null ? (
        <DownloadModalView
          isOpen
          isAnnotation={!isViewMode}
          onClose={() => setSelectedLayerForExport(null)}
          // -1 selects the "Full layer" bounding box in the export tab.
          initialBoundingBoxId={-1}
          initialTab="export"
        />
      ) : null}
    </div>
  );
}
