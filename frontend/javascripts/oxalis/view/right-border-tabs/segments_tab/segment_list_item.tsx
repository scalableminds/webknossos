// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'utility-types' or its correspo... Remove this comment to see the full error message
import { $Shape } from "utility-types";
import {
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
  EllipsisOutlined,
} from "@ant-design/icons";
import { List, Tooltip, Dropdown, Menu } from "antd";
import { useDispatch } from "react-redux";
import Checkbox from "antd/lib/checkbox/Checkbox";
import React from "react";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'clas... Remove this comment to see the full error message
import classnames from "classnames";
import type { APISegmentationLayer, APIMeshFile } from "types/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import {
  triggerIsosurfaceDownloadAction,
  updateIsosurfaceVisibilityAction,
  removeIsosurfaceAction,
  refreshIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import { withMappingActivationConfirmation } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import type { ActiveMappingInfo, IsosurfaceInformation, Segment } from "oxalis/store";
import Store from "oxalis/store";

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mappingColors' implicitly has an 'any' ... Remove this comment to see the full error message
const convertCellIdToCSS = (id: number, mappingColors) => {
  const [h, s, l, a] = jsConvertCellIdToHSLA(id, mappingColors);
  return `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mappingColors' implicitly has an 'any' ... Remove this comment to see the full error message
function getColoredDotIconForSegment(segmentId: number, mappingColors) {
  return (
    <span
      className="circle"
      style={{
        paddingLeft: "10px",
        backgroundColor: convertCellIdToCSS(segmentId, mappingColors),
      }}
    />
  );
}

// @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof MenuItem' is not assignab... Remove this comment to see the full error message
const MenuItemWithMappingActivationConfirmation = withMappingActivationConfirmation(Menu.Item);

const getLoadPrecomputedMeshMenuItem = (
  segment: Segment,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'currentMeshFile' implicitly has an 'any... Remove this comment to see the full error message
  currentMeshFile,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'loadPrecomputedMesh' implicitly has an ... Remove this comment to see the full error message
  loadPrecomputedMesh,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'andCloseContextMenu' implicitly has an ... Remove this comment to see the full error message
  andCloseContextMenu,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'layerName' implicitly has an 'any' type... Remove this comment to see the full error message
  layerName,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mappingInfo' implicitly has an 'any' ty... Remove this comment to see the full error message
  mappingInfo,
) => {
  const mappingName = currentMeshFile != null ? currentMeshFile.mappingName : undefined;
  return (
    <MenuItemWithMappingActivationConfirmation
      onClick={() =>
        andCloseContextMenu(
          // $FlowIgnore[incompatible-call] If currentMeshFile is null, the menu entry is disabled and cannot be clicked
          loadPrecomputedMesh(segment.id, segment.somePosition, currentMeshFile?.meshFileName),
        )
      }
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; onClick: () => any; dis... Remove this comment to see the full error message
      disabled={!currentMeshFile}
      mappingName={mappingName}
      descriptor="mesh file"
      layerName={layerName}
      mappingInfo={mappingInfo}
    >
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
    </MenuItemWithMappingActivationConfirmation>
  );
};

const getComputeMeshAdHocMenuItem = (
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'segment' implicitly has an 'any' type.
  segment,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'loadAdHocMesh' implicitly has an 'any' ... Remove this comment to see the full error message
  loadAdHocMesh,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'isSegmentationLayerVisible' implicitly ... Remove this comment to see the full error message
  isSegmentationLayerVisible,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'andCloseContextMenu' implicitly has an ... Remove this comment to see the full error message
  andCloseContextMenu,
) => {
  const { disabled, title } = getComputeMeshAdHocTooltipInfo(false, isSegmentationLayerVisible);
  return (
    <Menu.Item
      onClick={() => andCloseContextMenu(loadAdHocMesh(segment.id, segment.somePosition))}
      disabled={disabled}
    >
      <Tooltip title={title}>Compute Mesh (ad hoc)</Tooltip>
    </Menu.Item>
  );
};

const getMakeSegmentActiveMenuItem = (
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'segment' implicitly has an 'any' type.
  segment,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'setActiveCell' implicitly has an 'any' ... Remove this comment to see the full error message
  setActiveCell,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'activeCellId' implicitly has an 'any' t... Remove this comment to see the full error message
  activeCellId,
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'andCloseContextMenu' implicitly has an ... Remove this comment to see the full error message
  andCloseContextMenu,
) => {
  const disabled = segment.id === activeCellId;
  const title = disabled
    ? "This segment ID is already active."
    : "Make this the active segment ID.";
  return (
    <Menu.Item
      onClick={() => andCloseContextMenu(setActiveCell(segment.id, segment.somePosition))}
      disabled={disabled}
    >
      <Tooltip title={title}>Activate Segment ID</Tooltip>
    </Menu.Item>
  );
};

type Props = {
  segment: Segment;
  mapId: (arg0: number) => number;
  isJSONMappingEnabled: boolean;
  mappingInfo: ActiveMappingInfo;
  hoveredSegmentId: number | null | undefined;
  centeredSegmentId: number | null | undefined;
  selectedSegmentId: number | null | undefined;
  activeCellId: number | null | undefined;
  setHoveredSegmentId: (arg0: number | null | undefined) => void;
  handleSegmentDropdownMenuVisibility: (arg0: number, arg1: boolean) => void;
  activeDropdownSegmentId: number | null | undefined;
  allowUpdate: boolean;
  updateSegment: (arg0: number, arg1: $Shape<Segment>, arg2: string) => void;
  onSelectSegment: (arg0: Segment) => void;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  loadAdHocMesh: (arg0: number, arg1: Vector3) => void;
  loadPrecomputedMesh: (arg0: number, arg1: Vector3, arg2: string) => void;
  setActiveCell: (arg0: number, somePosition?: Vector3) => void;
  isosurface: IsosurfaceInformation | null | undefined;
  setPosition: (arg0: Vector3) => void;
  currentMeshFile: APIMeshFile | null | undefined;
};

function getSegmentTooltip(segment: Segment) {
  if (segment.creationTime == null) {
    return `Segment ${segment.id}`;
  }

  return `Segment ${segment.id} was registered at ${formatDateInLocalTimeZone(
    segment.creationTime,
  )}`;
}

function _SegmentListItem({
  segment,
  mapId,
  isJSONMappingEnabled,
  mappingInfo,
  hoveredSegmentId,
  centeredSegmentId,
  selectedSegmentId,
  activeCellId,
  setHoveredSegmentId,
  handleSegmentDropdownMenuVisibility,
  activeDropdownSegmentId,
  allowUpdate,
  updateSegment,
  onSelectSegment,
  visibleSegmentationLayer,
  loadAdHocMesh,
  setActiveCell,
  isosurface,
  setPosition,
  loadPrecomputedMesh,
  currentMeshFile,
}: Props) {
  const mappedId = mapId(segment.id);

  if (mappingInfo.hideUnmappedIds && mappedId === 0) {
    return null;
  }

  const andCloseContextMenu = (_ignore: any) => handleSegmentDropdownMenuVisibility(0, false);

  const createSegmentContextMenu = () => (
    <Menu>
      {getLoadPrecomputedMeshMenuItem(
        segment,
        currentMeshFile,
        loadPrecomputedMesh,
        andCloseContextMenu,
        visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
        mappingInfo,
      )}
      {getComputeMeshAdHocMenuItem(
        segment,
        loadAdHocMesh,
        visibleSegmentationLayer != null,
        andCloseContextMenu,
      )}
      {getMakeSegmentActiveMenuItem(segment, setActiveCell, activeCellId, andCloseContextMenu)}
    </Menu>
  );

  function getSegmentIdDetails() {
    if (isJSONMappingEnabled && segment.id !== mappedId)
      return (
        <Tooltip title="Segment ID (Unmapped ID → Mapped ID)">
          <span className="deemphasized-segment-name">
            {segment.id} → {mappedId}
          </span>
        </Tooltip>
      );
    // Only if segment.name is truthy, render additional info.
    return segment.name ? (
      <Tooltip title="Segment ID">
        <span className="deemphasized-segment-name">{segment.id}</span>
      </Tooltip>
    ) : null;
  }

  return (
    <List.Item
      style={{
        padding: "2px 5px",
      }}
      className={classnames("segment-list-item", {
        "is-selected-cell": segment.id === selectedSegmentId,
        "is-hovered-cell": segment.id === hoveredSegmentId,
      })}
      onMouseEnter={() => {
        setHoveredSegmentId(segment.id);
      }}
      onMouseLeave={() => {
        setHoveredSegmentId(null);
      }}
    >
      <Dropdown
        overlay={createSegmentContextMenu} // The overlay is generated lazily. By default, this would make the overlay
        // re-render on each parent's render() after it was shown for the first time.
        // The reason for this is that it's not destroyed after closing.
        // Therefore, autoDestroy is passed.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
        autoDestroy
        placement="bottomCenter"
        visible={activeDropdownSegmentId === segment.id}
        onVisibleChange={(isVisible) => handleSegmentDropdownMenuVisibility(segment.id, isVisible)}
        trigger={["contextMenu"]}
      >
        <Tooltip title={getSegmentTooltip(segment)}>
          {getColoredDotIconForSegment(mappedId, mappingInfo.mappingColors)}
          <EditableTextLabel
            value={segment.name || `Segment ${segment.id}`}
            label="Segment Name"
            onClick={() => onSelectSegment(segment)}
            onChange={(name) => {
              if (visibleSegmentationLayer != null) {
                updateSegment(
                  segment.id,
                  {
                    name,
                  },
                  visibleSegmentationLayer.name,
                );
              }
            }}
            margin="0 5px"
            disableEditing={!allowUpdate}
          />
          <Tooltip title="Open context menu (also available via right-click)">
            <EllipsisOutlined
              onClick={() => handleSegmentDropdownMenuVisibility(segment.id, true)}
            />
          </Tooltip>
          {/* Show Default Segment Name if another one is already defined*/}
          {getSegmentIdDetails()}
          {segment.id === centeredSegmentId ? (
            <Tooltip title="This segment is currently centered in the data viewports.">
              <i
                className="fas fa-crosshairs deemphasized-segment-name"
                style={{
                  marginLeft: 4,
                }}
              />
            </Tooltip>
          ) : null}
          {segment.id === activeCellId ? (
            <Tooltip title="The currently active segment id belongs to this segment.">
              <i
                className="fas fa-paint-brush deemphasized-segment-name"
                style={{
                  marginLeft: 4,
                }}
              />
            </Tooltip>
          ) : null}
        </Tooltip>
      </Dropdown>

      <div
        style={{
          marginLeft: 16,
        }}
      >
        <MeshInfoItem
          segment={segment}
          isSelectedInList={segment.id === selectedSegmentId}
          isHovered={segment.id === hoveredSegmentId}
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

function _MeshInfoItem(props: {
  segment: Segment;
  isSelectedInList: boolean;
  isHovered: boolean;
  isosurface: IsosurfaceInformation | null | undefined;
  handleSegmentDropdownMenuVisibility: (arg0: number, arg1: boolean) => void;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  setPosition: (arg0: Vector3) => void;
}) {
  const dispatch = useDispatch();

  const onChangeMeshVisibility = (layerName: string, id: number, isVisible: boolean) => {
    dispatch(updateIsosurfaceVisibilityAction(layerName, id, isVisible));
  };

  const { segment, isSelectedInList, isHovered, isosurface } = props;
  const deemphasizedStyle = {
    fontStyle: "italic",
    color: "#989898",
  };

  if (!isosurface) {
    if (isSelectedInList) {
      return (
        <div
          style={{ ...deemphasizedStyle, marginLeft: 8 }}
          onContextMenu={(evt) => {
            evt.preventDefault();
            props.handleSegmentDropdownMenuVisibility(segment.id, true);
          }}
        >
          No mesh loaded. Use right-click to add one.
        </div>
      );
    }

    return null;
  }

  const { seedPosition, isLoading, isPrecomputed, isVisible } = isosurface;
  const textStyle = isVisible ? {} : deemphasizedStyle;
  const downloadButton = (
    <Tooltip title="Download Mesh">
      <VerticalAlignBottomOutlined
        key="download-button"
        onClick={() =>
          Store.dispatch(
            triggerIsosurfaceDownloadAction(segment.name ? segment.name : "mesh", segment.id),
          )
        }
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
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(event: React.SyntheticEvent) => void' is no... Remove this comment to see the full error message
        onChange={(event: React.SyntheticEvent) => {
          if (!props.visibleSegmentationLayer) {
            return;
          }

          onChangeMeshVisibility(
            props.visibleSegmentationLayer.name,
            segment.id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'checked' does not exist on type 'EventTa... Remove this comment to see the full error message
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
            onClick={() => {
              props.setPosition(seedPosition);
            }}
            style={{ ...textStyle, marginLeft: 8 }}
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
          {getRefreshButton(segment, isPrecomputed, isLoading, props.visibleSegmentationLayer)}
          {downloadButton}
          {deleteButton}
        </div>
      </div>
    </div>
  );
}

const MeshInfoItem = React.memo(_MeshInfoItem);

function getRefreshButton(
  segment: Segment,
  isPrecomputed: boolean,
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
    return isPrecomputed ? null : (
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
