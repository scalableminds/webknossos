import {
  DeleteOutlined,
  EllipsisOutlined,
  LoadingOutlined,
  ReloadOutlined,
  TagsOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { App, List, type MenuProps } from "antd";
import Checkbox, { type CheckboxChangeEvent } from "antd/lib/checkbox/Checkbox";
import React from "react";
import { useDispatch, useSelector } from "react-redux";

import type { MenuItemType } from "antd/es/menu/interface";
import classnames from "classnames";
import {
  ChangeColorMenuItemContent,
  ChangeRGBAColorMenuItemContent,
} from "components/color_picker";
import FastTooltip from "components/fast_tooltip";
import { V4 } from "libs/mjs";
import Toast from "libs/toast";
import type { Vector3, Vector4 } from "oxalis/constants";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";
import {
  getAdditionalCoordinatesAsString,
  getPosition,
} from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentColorAsRGBA,
  getSegmentName,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  refreshMeshAction,
  removeMeshAction,
  triggerMeshDownloadAction,
  updateMeshVisibilityAction,
} from "oxalis/model/actions/annotation_actions";
import { rgbaToCSS } from "oxalis/shaders/utils.glsl";
import type {
  ActiveMappingInfo,
  MeshInformation,
  OxalisState,
  Segment,
  VolumeTracing,
} from "oxalis/store";
import Store from "oxalis/store";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import { getContextMenuPositionFromEvent } from "oxalis/view/context_menu";
import type { APIMeshFile, APISegmentationLayer } from "types/api_flow_types";
import type { AdditionalCoordinate } from "types/api_flow_types";
import { LoadMeshMenuItemLabel } from "./load_mesh_menu_item_label";
import { withMappingActivationConfirmation } from "./segments_view_helper";

const ALSO_DELETE_SEGMENT_FROM_LIST_KEY = "also-delete-segment-from-list";

import * as Utils from "libs/utils";
import Constants from "oxalis/constants";

export function ColoredDotIcon({ colorRGBA }: { colorRGBA: Vector4 }) {
  const rgbaCss = rgbaToCSS(colorRGBA);

  return (
    <span
      className="circle"
      style={{
        paddingLeft: "10px",
        backgroundColor: rgbaCss,
        alignSelf: "flex-start",
        marginTop: 5,
        marginLeft: 1,
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
  activeVolumeTracing: VolumeTracing | null | undefined,
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
      <LoadMeshMenuItemLabel
        currentMeshFile={currentMeshFile}
        volumeTracing={activeVolumeTracing}
      />
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
  mappingInfo: ActiveMappingInfo;
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
  setMeshOpacity: (
    arg0: number,
    arg1: string,
    arg2: number,
    arg3: AdditionalCoordinate[] | null | undefined,
  ) => void;
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
            "is-selected-segment": isSelectedInList,
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
  mappingInfo,
  selectedSegmentIds,
  activeCellId,
  setHoveredSegmentId,
  allowUpdate,
  updateSegment,
  removeSegment,
  setMeshOpacity,
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
  const { modal } = App.useApp();
  const isEditingDisabled = !allowUpdate;

  const segmentColorRGBA = useSelector(
    (state: OxalisState) => getSegmentColorAsRGBA(state, segment.id),
    (a: Vector4, b: Vector4) => V4.isEqual(a, b),
  );

  const additionalCoordinates = useSelector(
    (state: OxalisState) => state.flycam.additionalCoordinates,
  );

  const isHoveredSegmentId = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.hoveredSegmentId === segment.id,
  );
  const isCentered = useSelector((state: OxalisState) => {
    const centeredSegmentId = getSegmentIdForPosition(getPosition(state.flycam));
    return centeredSegmentId === segment.id;
  });

  const segmentColorWithMeshOpacity: Vector4 = [
    segmentColorRGBA[0],
    segmentColorRGBA[1],
    segmentColorRGBA[2],
    mesh != null ? mesh.opacity : Constants.DEFAULT_MESH_OPACITY,
  ];

  const createSegmentContextMenu = (): MenuProps => ({
    items: [
      getLoadPrecomputedMeshMenuItem(
        segment,
        currentMeshFile,
        loadPrecomputedMesh,
        hideContextMenu,
        visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
        mappingInfo,
        activeVolumeTracing,
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
        key: `changeSegmentColor-${segment.id}`,
        label: mesh?.isVisible ? (
          <ChangeRGBAColorMenuItemContent
            isDisabled={false}
            title="Change Segment Color"
            onSetColor={(color, createsNewUndoState) => {
              if (visibleSegmentationLayer == null) {
                return;
              }
              updateSegment(
                segment.id,
                {
                  color: color.slice(0, 3) as Vector3,
                },
                visibleSegmentationLayer.name,
                createsNewUndoState,
              );
              setMeshOpacity(
                segment.id,
                visibleSegmentationLayer.name,
                color[3],
                additionalCoordinates,
              );
            }}
            rgba={segmentColorWithMeshOpacity}
          />
        ) : (
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
    // Only if segment.name is truthy, render additional info.
    return segment.name ? (
      <FastTooltip title="Segment ID">
        <span className="deemphasized italic">{segment.id}</span>
      </FastTooltip>
    ) : null;
  }

  const onOpenContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const [x, y] = getContextMenuPositionFromEvent(event, "segment-list-context-menu-overlay");

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
      className={`segment-list-item ${isHoveredSegmentId ? "is-hovered-segment" : ""}`}
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
          <ColoredDotIcon colorRGBA={segmentColorRGBA} />
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
            iconClassName="deemphasized"
            disableEditing={!allowUpdate}
          />
          {(segment.metadata || []).length > 0 ? (
            <FastTooltip
              className="deemphasized icon-margin-right"
              title="This segment has assigned metadata properties."
            >
              <TagsOutlined />
            </FastTooltip>
          ) : null}
          <FastTooltip title="Open context menu (also available via right-click)">
            <EllipsisOutlined onClick={onOpenContextMenu} />
          </FastTooltip>
          {/* Show Default Segment Name if another one is already defined*/}
          {getSegmentIdDetails()}
          {isCentered ? (
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
