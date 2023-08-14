import {
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
  EllipsisOutlined,
} from "@ant-design/icons";
import { List, Tooltip, Dropdown, MenuProps } from "antd";
import { useDispatch, useSelector } from "react-redux";
import Checkbox, { CheckboxChangeEvent } from "antd/lib/checkbox/Checkbox";
import React from "react";

import classnames from "classnames";
import * as Utils from "libs/utils";
import type { APISegmentationLayer, APIMeshFile } from "types/api_flow_types";
import type { Vector3, Vector4 } from "oxalis/constants";
import {
  triggerIsosurfaceDownloadAction,
  updateIsosurfaceVisibilityAction,
  removeIsosurfaceAction,
  refreshIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import type { ActiveMappingInfo, IsosurfaceInformation, OxalisState, Segment } from "oxalis/store";
import Store from "oxalis/store";
import { getSegmentColorAsHSLA } from "oxalis/model/accessors/volumetracing_accessor";
import Toast from "libs/toast";
import { hslaToCSS } from "oxalis/shaders/utils.glsl";
import { V4 } from "libs/mjs";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { MenuItemType } from "antd/lib/menu/hooks/useItems";
import { withMappingActivationConfirmation } from "./segments_view_helper";

function ColoredDotIconForSegment({ segmentColorHSLA }: { segmentColorHSLA: Vector4 }) {
  const hslaCss = hslaToCSS(segmentColorHSLA);

  return (
    <span
      className="circle"
      style={{
        paddingLeft: "10px",
        backgroundColor: hslaCss,
      }}
    />
  );
}

const getLoadPrecomputedMeshMenuItem = (
  segment: Segment,
  currentMeshFile: APIMeshFile | null | undefined,
  loadPrecomputedMesh: (arg0: number, arg1: Vector3, arg2: string) => void,
  andCloseContextMenu: (_ignore?: any) => void,
  layerName: string | null | undefined,
  mappingInfo: ActiveMappingInfo,
) => {
  const mappingName = currentMeshFile != null ? currentMeshFile.mappingName : undefined;
  return {
    key: "loadPrecomputedMesh",
    disabled: !currentMeshFile,
    onClick: withMappingActivationConfirmation(
      () => {
        if (!currentMeshFile) {
          return;
        }
        if (!segment.somePosition) {
          Toast.info(
            <React.Fragment>
              Cannot load a mesh for this segment, because its position is unknown.
            </React.Fragment>,
          );
          andCloseContextMenu();
          return;
        }
        andCloseContextMenu(
          loadPrecomputedMesh(segment.id, segment.somePosition, currentMeshFile?.meshFileName),
        );
      },
      mappingName,
      "mesh file",
      layerName,
      mappingInfo,
    ),
    label: (
      <Tooltip
        key="tooltip"
        title={
          currentMeshFile != null
            ? `Load mesh for centered segment from file ${currentMeshFile.meshFileName}`
            : "There is no mesh file."
        }
      >
        Load Mesh (precomputed)
      </Tooltip>
    ),
  };
};

const getComputeMeshAdHocMenuItem = (
  segment: Segment,
  loadAdHocMesh: (arg0: number, arg1: Vector3) => void,
  isSegmentationLayerVisible: boolean,
  andCloseContextMenu: (_ignore?: any) => void,
): MenuItemType => {
  const { disabled, title } = getComputeMeshAdHocTooltipInfo(false, isSegmentationLayerVisible);
  return {
    key: "loadAdHocMesh",
    onClick: () => {
      if (!segment.somePosition) {
        Toast.info(
          <React.Fragment>
            Cannot load a mesh for this segment, because its position is unknown.
          </React.Fragment>,
        );
        andCloseContextMenu();
        return;
      }

      andCloseContextMenu(loadAdHocMesh(segment.id, segment.somePosition));
    },
    disabled,
    label: <Tooltip title={title}>Compute Mesh (ad hoc)</Tooltip>,
  };
};

const getMakeSegmentActiveMenuItem = (
  segment: Segment,
  setActiveCell: (arg0: number, somePosition?: Vector3) => void,
  activeCellId: number | null | undefined,
  andCloseContextMenu: (_ignore?: any) => void,
): MenuItemType => {
  const disabled = segment.id === activeCellId;
  const title = disabled
    ? "This segment ID is already active."
    : "Make this the active segment ID.";
  return {
    key: "setActiveCell",
    onClick: () => andCloseContextMenu(setActiveCell(segment.id, segment.somePosition)),
    disabled,
    label: <Tooltip title={title}>Activate Segment ID</Tooltip>,
  };
};

type Props = {
  segment: Segment;
  mapId: (arg0: number) => number;
  isJSONMappingEnabled: boolean;
  mappingInfo: ActiveMappingInfo;
  isHoveredSegmentId: boolean;
  centeredSegmentId: number | null | undefined;
  selectedSegmentIds: number[] | null | undefined;
  activeCellId: number | null | undefined;
  setHoveredSegmentId: (arg0: number | null | undefined) => void;
  handleSegmentDropdownMenuVisibility: (arg0: boolean, arg1: number) => void;
  activeDropdownSegmentId: number | null | undefined;
  allowUpdate: boolean;
  updateSegment: (
    arg0: number,
    arg1: Partial<Segment>,
    arg2: string,
    createsNewUndoState: boolean,
  ) => void;
  removeSegment: (arg0: number, arg2: string) => void;
  onSelectSegment: (arg0: Segment) => void;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  loadAdHocMesh: (arg0: number, arg1: Vector3) => void;
  loadPrecomputedMesh: (arg0: number, arg1: Vector3, arg2: string) => void;
  setActiveCell: (arg0: number, somePosition?: Vector3) => void;
  isosurface: IsosurfaceInformation | null | undefined;
  setPosition: (arg0: Vector3) => void;
  currentMeshFile: APIMeshFile | null | undefined;
  onRenameStart: () => void;
  onRenameEnd: () => void;
  multiSelectMenu: MenuProps;
};

function _MeshInfoItem(props: {
  segment: Segment;
  isSelectedInList: boolean;
  isHovered: boolean;
  isosurface: IsosurfaceInformation | null | undefined;
  handleSegmentDropdownMenuVisibility: (arg0: boolean, arg1: number) => void;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  setPosition: (arg0: Vector3) => void;
}) {
  const dispatch = useDispatch();

  const onChangeMeshVisibility = (layerName: string, id: number, isVisible: boolean) => {
    dispatch(updateIsosurfaceVisibilityAction(layerName, id, isVisible));
  };

  const { segment, isSelectedInList, isHovered, isosurface } = props;

  if (!isosurface) {
    if (isSelectedInList) {
      return (
        <div
          className="deemphasized italic"
          style={{ marginLeft: 8 }}
          onContextMenu={(evt) => {
            evt.preventDefault();
            props.handleSegmentDropdownMenuVisibility(true, segment.id);
          }}
        >
          No mesh loaded. Use right-click to add one.
        </div>
      );
    }

    return null;
  }

  const { seedPosition, isLoading, isPrecomputed, isVisible } = isosurface;
  const className = isVisible ? "" : "deemphasized italic";
  const downloadButton = (
    <Tooltip title="Download Mesh">
      <VerticalAlignBottomOutlined
        key="download-button"
        onClick={() => {
          if (!props.visibleSegmentationLayer) {
            return;
          }
          Store.dispatch(
            triggerIsosurfaceDownloadAction(
              segment.name ? segment.name : "mesh",
              segment.id,
              props.visibleSegmentationLayer.name,
            ),
          );
        }}
      />
    </Tooltip>
  );
  const deleteButton = (
    <Tooltip title="Remove Mesh">
      <DeleteOutlined
        key="delete-button"
        onClick={() => {
          if (!props.visibleSegmentationLayer) {
            return;
          }

          Store.dispatch(removeIsosurfaceAction(props.visibleSegmentationLayer.name, segment.id));
        }}
      />
    </Tooltip>
  );
  const toggleVisibilityCheckbox = (
    <Tooltip title="Change visibility">
      <Checkbox
        checked={isVisible}
        onChange={(event: CheckboxChangeEvent) => {
          if (!props.visibleSegmentationLayer) {
            return;
          }

          onChangeMeshVisibility(
            props.visibleSegmentationLayer.name,
            segment.id,
            event.target.checked,
          );
        }}
      />
    </Tooltip>
  );
  const actionVisibility = isLoading || isHovered ? "visible" : "hidden";
  return (
    <div
      style={{
        padding: 0,
        cursor: "pointer",
      }}
      key={segment.id}
    >
      <div
        style={{
          display: "flex",
        }}
      >
        <div
          className={classnames("segment-list-item", {
            "is-selected-cell": isSelectedInList,
          })}
        >
          {toggleVisibilityCheckbox}
          <span
            className={className}
            onClick={() => {
              props.setPosition(seedPosition);
            }}
            style={{ marginLeft: 8 }}
          >
            {isPrecomputed ? "Mesh (precomputed)" : "Mesh (ad-hoc computed)"}
          </span>
        </div>
        <div
          style={{
            visibility: actionVisibility,
            marginLeft: 6,
          }}
        >
          {getRefreshButton(segment, isLoading, props.visibleSegmentationLayer)}
          {downloadButton}
          {deleteButton}
        </div>
      </div>
    </div>
  );
}

const MeshInfoItem = React.memo(_MeshInfoItem);

function _SegmentListItem({
  segment,
  mapId,
  isJSONMappingEnabled,
  mappingInfo,
  isHoveredSegmentId,
  centeredSegmentId,
  selectedSegmentIds,
  activeCellId,
  setHoveredSegmentId,
  handleSegmentDropdownMenuVisibility,
  activeDropdownSegmentId,
  allowUpdate,
  updateSegment,
  removeSegment,
  onSelectSegment,
  visibleSegmentationLayer,
  loadAdHocMesh,
  setActiveCell,
  isosurface,
  setPosition,
  loadPrecomputedMesh,
  currentMeshFile,
  onRenameStart,
  onRenameEnd,
  multiSelectMenu,
}: Props) {
  const isEditingDisabled = !allowUpdate;

  const mappedId = mapId(segment.id);

  const segmentColorHSLA = useSelector(
    (state: OxalisState) => getSegmentColorAsHSLA(state, mappedId),
    (a: Vector4, b: Vector4) => V4.isEqual(a, b),
  );

  const segmentColorRGBA = Utils.hslaToRgba(segmentColorHSLA);

  if (mappingInfo.hideUnmappedIds && mappedId === 0) {
    return null;
  }

  const andCloseContextMenu = (_ignore?: any) => handleSegmentDropdownMenuVisibility(false, 0);

  const createSegmentContextMenu = (): MenuProps => ({
    items: [
      getLoadPrecomputedMeshMenuItem(
        segment,
        currentMeshFile,
        loadPrecomputedMesh,
        andCloseContextMenu,
        visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
        mappingInfo,
      ),
      getComputeMeshAdHocMenuItem(
        segment,
        loadAdHocMesh,
        visibleSegmentationLayer != null,
        andCloseContextMenu,
      ),
      getMakeSegmentActiveMenuItem(segment, setActiveCell, activeCellId, andCloseContextMenu),
      {
        key: "changeSegmentColor",
        /*
         * Disable the change-color menu if the segment was mapped to another segment, because
         * changing the color wouldn't do anything as long as the mapping is still active.
         * This is because the id (A) is mapped to another one (B). So, the user would need
         * to change the color of B to see the effect for A.
         */
        disabled: isEditingDisabled || segment.id !== mappedId,
        label: (
          <ChangeColorMenuItemContent
            isDisabled={isEditingDisabled}
            title="Change Segment Color"
            onSetColor={(color, createsNewUndoState) => {
              if (visibleSegmentationLayer == null) {
                return;
              }
              updateSegment(
                segment.id,
                {
                  color,
                },
                visibleSegmentationLayer.name,
                createsNewUndoState,
              );
            }}
            rgb={Utils.take3(segmentColorRGBA)}
            hidePickerIcon
          />
        ),
      },
      {
        key: "resetSegmentColor",
        disabled: isEditingDisabled || segment.color == null,
        onClick: () => {
          if (isEditingDisabled || visibleSegmentationLayer == null) {
            return;
          }
          updateSegment(
            segment.id,
            {
              color: null,
            },
            visibleSegmentationLayer.name,
            true,
          );
        },
        label: "Reset Segment Color",
      },
      {
        key: "removeSegmentFromList",
        disabled: isEditingDisabled,
        onClick: () => {
          if (isEditingDisabled || visibleSegmentationLayer == null) {
            return;
          }
          removeSegment(segment.id, visibleSegmentationLayer.name);
          andCloseContextMenu();
        },
        label: "Remove Segment From List",
      },
    ],
  });

  function getSegmentIdDetails() {
    if (isJSONMappingEnabled && segment.id !== mappedId)
      return (
        <Tooltip title="Segment ID (Unmapped ID → Mapped ID)">
          <span className="deemphasized italic">
            {segment.id} → {mappedId}
          </span>
        </Tooltip>
      );
    // Only if segment.name is truthy, render additional info.
    return segment.name ? (
      <Tooltip title="Segment ID">
        <span className="deemphasized italic">{segment.id}</span>
      </Tooltip>
    ) : null;
  }

  return (
    <List.Item
      style={{
        padding: "2px 5px",
      }}
      className="segment-list-item"
      onMouseEnter={() => {
        setHoveredSegmentId(segment.id);
      }}
      onMouseLeave={() => {
        setHoveredSegmentId(null);
      }}
    >
      <Dropdown
        menu={
          (selectedSegmentIds || []).length > 1 && selectedSegmentIds?.includes(segment.id)
            ? multiSelectMenu
            : createSegmentContextMenu()
        } // The overlay is generated lazily. By default, this would make the overlay
        // re-render on each parent's render() after it was shown for the first time.
        // The reason for this is that it's not destroyed after closing.
        // Therefore, autoDestroy is passed.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
        autoDestroy
        placement="bottom"
        open={activeDropdownSegmentId === segment.id}
        onOpenChange={(isVisible) => handleSegmentDropdownMenuVisibility(isVisible, segment.id)}
        trigger={["contextMenu"]}
      >
        <div style={{ display: "inline-flex", alignItems: "center" }}>
          <ColoredDotIconForSegment segmentColorHSLA={segmentColorHSLA} />
          <EditableTextLabel
            value={segment.name || `Segment ${segment.id}`}
            label="Segment Name"
            onClick={() => onSelectSegment(segment)}
            onRenameStart={onRenameStart}
            onRenameEnd={onRenameEnd}
            onChange={(name) => {
              if (visibleSegmentationLayer != null) {
                updateSegment(
                  segment.id,
                  {
                    name,
                  },
                  visibleSegmentationLayer.name,
                  true,
                );
              }
            }}
            margin="0 5px"
            disableEditing={!allowUpdate}
          />
          <Tooltip title="Open context menu (also available via right-click)">
            <EllipsisOutlined
              onClick={() => handleSegmentDropdownMenuVisibility(true, segment.id)}
            />
          </Tooltip>
          {/* Show Default Segment Name if another one is already defined*/}
          {getSegmentIdDetails()}
          {segment.id === centeredSegmentId ? (
            <Tooltip title="This segment is currently centered in the data viewports.">
              <i
                className="fas fa-crosshairs deemphasized"
                style={{
                  marginLeft: 4,
                }}
              />
            </Tooltip>
          ) : null}
          {segment.id === activeCellId ? (
            <Tooltip title="The currently active segment id belongs to this segment.">
              <i
                className="fas fa-paint-brush deemphasized"
                style={{
                  marginLeft: 4,
                }}
              />
            </Tooltip>
          ) : null}
        </div>
      </Dropdown>

      <div
        style={{
          marginLeft: 16,
        }}
      >
        <MeshInfoItem
          segment={segment}
          isSelectedInList={
            selectedSegmentIds != null ? selectedSegmentIds?.includes(segment.id) : false
          }
          isHovered={isHoveredSegmentId}
          isosurface={isosurface}
          handleSegmentDropdownMenuVisibility={handleSegmentDropdownMenuVisibility}
          visibleSegmentationLayer={visibleSegmentationLayer}
          setPosition={setPosition}
        />
      </div>
    </List.Item>
  );
}

const SegmentListItem = React.memo<Props>(_SegmentListItem);

function getRefreshButton(
  segment: Segment,
  isLoading: boolean,
  visibleSegmentationLayer: APISegmentationLayer | null | undefined,
) {
  if (isLoading) {
    return (
      <LoadingOutlined
        key="refresh-button"
        onClick={() => {
          if (!visibleSegmentationLayer) {
            return;
          }

          Store.dispatch(refreshIsosurfaceAction(visibleSegmentationLayer.name, segment.id));
        }}
      />
    );
  } else {
    return (
      <Tooltip title="Refresh Mesh">
        <ReloadOutlined
          key="refresh-button"
          onClick={() => {
            if (!visibleSegmentationLayer) {
              return;
            }

            Store.dispatch(refreshIsosurfaceAction(visibleSegmentationLayer.name, segment.id));
          }}
        />
      </Tooltip>
    );
  }
}

function getComputeMeshAdHocTooltipInfo(
  isForCenteredSegment: boolean,
  isSegmentationLayerVisible: boolean,
) {
  let title = "";
  let disabled = true;

  if (!isSegmentationLayerVisible) {
    title = "There is no visible segmentation layer for which a mesh could be computed.";
  } else {
    title = `Compute mesh for ${isForCenteredSegment ? "the centered" : "this"} segment.`;
    disabled = false;
  }

  return {
    disabled,
    title,
  };
}

export default SegmentListItem;
