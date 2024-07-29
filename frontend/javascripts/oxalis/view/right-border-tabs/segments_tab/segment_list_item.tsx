import {
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
  EllipsisOutlined,
} from "@ant-design/icons";
import { List, MenuProps, App } from "antd";
import { useDispatch, useSelector } from "react-redux";
import Checkbox, { CheckboxChangeEvent } from "antd/lib/checkbox/Checkbox";
import React from "react";

import classnames from "classnames";
import * as Utils from "libs/utils";
import type { APISegmentationLayer, APIMeshFile } from "types/api_flow_types";
import type { Vector3, Vector4 } from "oxalis/constants";
import {
  triggerMeshDownloadAction,
  updateMeshVisibilityAction,
  removeMeshAction,
  refreshMeshAction,
} from "oxalis/model/actions/annotation_actions";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import type {
  ActiveMappingInfo,
  MeshInformation,
  OxalisState,
  Segment,
  VolumeTracing,
} from "oxalis/store";
import Store from "oxalis/store";
import {
  getSegmentColorAsHSLA,
  getSegmentName,
} from "oxalis/model/accessors/volumetracing_accessor";
import Toast from "libs/toast";
import { hslaToCSS } from "oxalis/shaders/utils.glsl";
import { V4 } from "libs/mjs";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { MenuItemType } from "antd/lib/menu/hooks/useItems";
import { withMappingActivationConfirmation } from "./segments_view_helper";
import { type AdditionalCoordinate } from "types/api_flow_types";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";
import FastTooltip from "components/fast_tooltip";

// const FastTooltip = Tooltip;

const ALSO_DELETE_SEGMENT_FROM_LIST_KEY = "also-delete-segment-from-list";

export function ColoredDotIconForSegment({ segmentColorHSLA }: { segmentColorHSLA: Vector4 }) {
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
  loadPrecomputedMesh: (
    segmentId: number,
    seedPosition: Vector3,
    seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
    meshFileName: string,
  ) => void,
  hideContextMenu: (_ignore?: any) => void,
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
          hideContextMenu();
          return;
        }
        hideContextMenu(
          loadPrecomputedMesh(
            segment.id,
            segment.somePosition,
            segment.someAdditionalCoordinates,
            currentMeshFile?.meshFileName,
          ),
        );
      },
      mappingName,
      "mesh file",
      layerName,
      mappingInfo,
    ),
    label: (
      <FastTooltip
        key="tooltip"
        title={
          currentMeshFile != null
            ? `Load mesh for centered segment from file ${currentMeshFile.meshFileName}`
            : "There is no mesh file."
        }
      >
        Load Mesh (precomputed)
      </FastTooltip>
    ),
  };
};

const getComputeMeshAdHocMenuItem = (
  segment: Segment,
  loadAdHocMesh: (
    segmentId: number,
    seedPosition: Vector3,
    seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  ) => void,
  isSegmentationLayerVisible: boolean,
  hideContextMenu: (_ignore?: any) => void,
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
        hideContextMenu();
        return;
      }
      hideContextMenu(
        loadAdHocMesh(
          segment.id,
          segment.somePosition,
          Store.getState().flycam.additionalCoordinates,
        ),
      );
    },
    disabled,
    label: <FastTooltip title={title}>Compute Mesh (ad hoc)</FastTooltip>,
  };
};

const getMakeSegmentActiveMenuItem = (
  segment: Segment,
  setActiveCell: (
    arg0: number,
    somePosition?: Vector3,
    someAdditionalCoordinates?: AdditionalCoordinate[] | null,
  ) => void,
  activeCellId: number | null | undefined,
  isEditingDisabled: boolean,
  hideContextMenu: (_ignore?: any) => void,
): MenuItemType => {
  const isActiveSegment = segment.id === activeCellId;
  const title = isActiveSegment
    ? "This segment ID is already active."
    : "Make this the active segment ID.";
  return {
    key: "setActiveCell",
    onClick: () =>
      hideContextMenu(
        setActiveCell(segment.id, segment.somePosition, segment.someAdditionalCoordinates),
      ),
    disabled: isActiveSegment || isEditingDisabled,
    label: (
      <FastTooltip title={title} disabled={isEditingDisabled}>
        Activate Segment ID
      </FastTooltip>
    ),
  };
};

type Props = {
  segment: Segment;
  mapId: (arg0: number) => number;
  isJSONMappingEnabled: boolean;
  mappingInfo: ActiveMappingInfo;
  centeredSegmentId: number | null | undefined;
  selectedSegmentIds: number[] | null | undefined;
  activeCellId: number | null | undefined;
  setHoveredSegmentId: (arg0: number | null | undefined) => void;
  allowUpdate: boolean;
  updateSegment: (
    arg0: number,
    arg1: Partial<Segment>,
    arg2: string,
    createsNewUndoState: boolean,
  ) => void;
  removeSegment: (arg0: number, arg2: string) => void;
  deleteSegmentData: (arg0: number, arg2: string, callback?: () => void) => void;
  onSelectSegment: (arg0: Segment) => void;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  loadAdHocMesh: (
    segmentId: number,
    somePosition: Vector3,
    someAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  ) => void;
  loadPrecomputedMesh: (
    segmentId: number,
    seedPosition: Vector3,
    seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
    meshFileName: string,
  ) => void;
  setActiveCell: (
    arg0: number,
    somePosition?: Vector3,
    someAdditionalCoordinates?: AdditionalCoordinate[] | null,
  ) => void;
  mesh: MeshInformation | null | undefined;
  setPosition: (arg0: Vector3) => void;
  setAdditionalCoordinates: (
    additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  ) => void;
  currentMeshFile: APIMeshFile | null | undefined;
  onRenameStart: () => void;
  onRenameEnd: () => void;
  multiSelectMenu: MenuProps;
  activeVolumeTracing: VolumeTracing | null | undefined;
  showContextMenuAt: (xPos: number, yPos: number, menu: MenuProps) => void;
  hideContextMenu: () => void;
};

function _MeshInfoItem(props: {
  segment: Segment;
  isSelectedInList: boolean;
  isHovered: boolean;
  mesh: MeshInformation | null | undefined;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  setPosition: (arg0: Vector3) => void;
  setAdditionalCoordinates: (additionalCoordinates: AdditionalCoordinate[] | undefined) => void;
}) {
  const additionalCoordinates = useSelector(
    (state: OxalisState) => state.flycam.additionalCoordinates,
  );
  const dispatch = useDispatch();
  const onChangeMeshVisibility = (layerName: string, id: number, isVisible: boolean) => {
    dispatch(updateMeshVisibilityAction(layerName, id, isVisible, mesh?.seedAdditionalCoordinates));
  };

  const { segment, isSelectedInList, isHovered, mesh } = props;

  if (
    !mesh ||
    getAdditionalCoordinatesAsString(mesh.seedAdditionalCoordinates) !==
      getAdditionalCoordinatesAsString(additionalCoordinates)
  ) {
    if (isSelectedInList) {
      return (
        <div className="deemphasized italic" style={{ marginLeft: 8 }}>
          No mesh loaded. Use right-click to add one.
        </div>
      );
    }

    return null;
  }

  const { seedPosition, seedAdditionalCoordinates, isLoading, isPrecomputed, isVisible } = mesh;
  const className = isVisible ? "" : "deemphasized italic";
  const downloadButton = (
    <FastTooltip title="Download Mesh">
      <VerticalAlignBottomOutlined
        key="download-button"
        onClick={() => {
          if (!props.visibleSegmentationLayer) {
            return;
          }
          Store.dispatch(
            triggerMeshDownloadAction(
              segment.name ? segment.name : "mesh",
              segment.id,
              props.visibleSegmentationLayer.name,
            ),
          );
        }}
      />
    </FastTooltip>
  );
  const deleteButton = (
    <FastTooltip title="Remove Mesh">
      <DeleteOutlined
        key="delete-button"
        onClick={() => {
          if (!props.visibleSegmentationLayer) {
            return;
          }

          Store.dispatch(removeMeshAction(props.visibleSegmentationLayer.name, segment.id));
        }}
      />
    </FastTooltip>
  );
  const toggleVisibilityCheckbox = (
    <FastTooltip title="Change visibility">
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
    </FastTooltip>
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
              if (seedAdditionalCoordinates) {
                props.setAdditionalCoordinates(seedAdditionalCoordinates);
              }
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
  centeredSegmentId,
  selectedSegmentIds,
  activeCellId,
  setHoveredSegmentId,
  allowUpdate,
  updateSegment,
  removeSegment,
  deleteSegmentData,
  onSelectSegment,
  visibleSegmentationLayer,
  loadAdHocMesh,
  setActiveCell,
  mesh,
  setPosition,
  setAdditionalCoordinates,
  loadPrecomputedMesh,
  currentMeshFile,
  onRenameStart,
  onRenameEnd,
  multiSelectMenu,
  activeVolumeTracing,
  showContextMenuAt,
  hideContextMenu,
}: Props) {
  // return (
  //   <List.Item
  //     style={{
  //       padding: "2px 5px",
  //     }}
  //     className="segment-list-item"
  //     onMouseEnter={() => {
  //       setHoveredSegmentId(segment.id);
  //     }}
  //     onMouseLeave={() => {
  //       setHoveredSegmentId(null);
  //     }}
  //   >
  //     {segment.id}
  //   </List.Item>
  // );

  const { modal } = App.useApp();
  const isEditingDisabled = !allowUpdate;

  const mappedId = mapId(segment.id);

  const segmentColorHSLA = useSelector(
    (state: OxalisState) => getSegmentColorAsHSLA(state, mappedId),
    (a: Vector4, b: Vector4) => V4.isEqual(a, b),
  );
  const isHoveredSegmentId = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.hoveredSegmentId === segment.id,
  );

  const segmentColorRGBA = Utils.hslaToRgba(segmentColorHSLA);

  if (mappingInfo.hideUnmappedIds && mappedId === 0) {
    return null;
  }

  const createSegmentContextMenu = (): MenuProps => ({
    items: [
      getLoadPrecomputedMeshMenuItem(
        segment,
        currentMeshFile,
        loadPrecomputedMesh,
        hideContextMenu,
        visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
        mappingInfo,
      ),
      getComputeMeshAdHocMenuItem(
        segment,
        loadAdHocMesh,
        visibleSegmentationLayer != null,
        hideContextMenu,
      ),
      getMakeSegmentActiveMenuItem(
        segment,
        setActiveCell,
        activeCellId,
        isEditingDisabled,
        hideContextMenu,
      ),
      {
        key: "changeSegmentColor",
        /*
         * Disable the change-color menu if the segment was mapped to another segment, because
         * changing the color wouldn't do anything as long as the mapping is still active.
         * This is because the id (A) is mapped to another one (B). So, the user would need
         * to change the color of B to see the effect for A.
         */
        disabled: segment.id !== mappedId,
        label: (
          <ChangeColorMenuItemContent
            isDisabled={false}
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
          />
        ),
      },
      {
        key: "resetSegmentColor",
        disabled: segment.color == null,
        onClick: () => {
          if (visibleSegmentationLayer == null) {
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
        onClick: () => {
          if (visibleSegmentationLayer == null) {
            return;
          }
          removeSegment(segment.id, visibleSegmentationLayer.name);
          hideContextMenu();
        },
        label: "Remove Segment From List",
      },
      {
        key: "deleteSegmentData",
        onClick: () => {
          if (visibleSegmentationLayer == null) {
            return;
          }

          modal.confirm({
            content: `Are you sure you want to delete the data of segment ${getSegmentName(
              segment,
              true,
            )}? This operation will set all voxels with id ${segment.id} to 0.`,
            okText: "Yes, delete",
            okType: "danger",
            onOk: async () => {
              await new Promise<void>((resolve) =>
                deleteSegmentData(segment.id, visibleSegmentationLayer.name, resolve),
              );

              Toast.info(
                <span>
                  The data of segment {getSegmentName(segment, true)} was deleted.{" "}
                  <a
                    href="#"
                    onClick={() => {
                      removeSegment(segment.id, visibleSegmentationLayer.name);
                      Toast.close(ALSO_DELETE_SEGMENT_FROM_LIST_KEY);
                    }}
                  >
                    Also remove from list.
                  </a>
                </span>,
                { key: ALSO_DELETE_SEGMENT_FROM_LIST_KEY },
              );
            },
          });

          hideContextMenu();
        },
        disabled:
          activeVolumeTracing == null ||
          !activeVolumeTracing.hasSegmentIndex ||
          // Not supported for fallback layers, yet.
          activeVolumeTracing.fallbackLayer != null,
        label: "Delete Segment's Data",
      },
    ],
  });

  function getSegmentIdDetails() {
    if (isJSONMappingEnabled && segment.id !== mappedId)
      return (
        <FastTooltip title="Segment ID (Unmapped ID → Mapped ID)">
          <span className="deemphasized italic">
            {segment.id} → {mappedId}
          </span>
        </FastTooltip>
      );
    // Only if segment.name is truthy, render additional info.
    return segment.name ? (
      <FastTooltip title="Segment ID">
        <span className="deemphasized italic">{segment.id}</span>
      </FastTooltip>
    ) : null;
  }

  const onOpenContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const overlayDivs = document.getElementsByClassName("segment-list-context-menu-overlay");
    const referenceDiv = Array.from(overlayDivs)
      .map((p) => p.parentElement)
      .find((potentialParent) => {
        if (potentialParent == null) {
          return false;
        }
        const bounds = potentialParent.getBoundingClientRect();
        return bounds.width > 0;
      });

    if (referenceDiv == null) {
      return;
    }
    const bounds = referenceDiv.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;

    showContextMenuAt(
      x,
      y,
      (selectedSegmentIds || []).length > 1 && selectedSegmentIds?.includes(segment.id)
        ? multiSelectMenu
        : createSegmentContextMenu(),
    );
  };

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
      onContextMenu={onOpenContextMenu}
    >
      <div>
        <div style={{ display: "inline-flex", alignItems: "center" }}>
          <ColoredDotIconForSegment segmentColorHSLA={segmentColorHSLA} />
          <EditableTextLabel
            value={getSegmentName(segment)}
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
          <FastTooltip title="Open context menu (also available via right-click)">
            <EllipsisOutlined onClick={onOpenContextMenu} />
          </FastTooltip>
          {/* Show Default Segment Name if another one is already defined*/}
          {getSegmentIdDetails()}
          {segment.id === centeredSegmentId ? (
            <FastTooltip title="This segment is currently centered in the data viewports.">
              <i
                className="fas fa-crosshairs deemphasized"
                style={{
                  marginLeft: 4,
                }}
              />
            </FastTooltip>
          ) : null}
          {segment.id === activeCellId ? (
            <FastTooltip title="The currently active segment id belongs to this segment.">
              <i
                className="fas fa-paint-brush deemphasized"
                style={{
                  marginLeft: 4,
                }}
              />
            </FastTooltip>
          ) : null}
        </div>

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
            mesh={mesh}
            visibleSegmentationLayer={visibleSegmentationLayer}
            setPosition={setPosition}
            setAdditionalCoordinates={setAdditionalCoordinates}
          />
        </div>
      </div>
      {/*</Dropdown>*/}
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

          Store.dispatch(refreshMeshAction(visibleSegmentationLayer.name, segment.id));
        }}
      />
    );
  } else {
    return (
      <FastTooltip title="Refresh Mesh">
        <ReloadOutlined
          key="refresh-button"
          onClick={() => {
            if (!visibleSegmentationLayer) {
              return;
            }

            Store.dispatch(refreshMeshAction(visibleSegmentationLayer.name, segment.id));
          }}
        />
      </FastTooltip>
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
