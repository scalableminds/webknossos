// @flow
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
import classnames from "classnames";

import type { APISegmentationLayer } from "types/api_flow_types";
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
import Store, {
  type ActiveMappingInfo,
  type IsosurfaceInformation,
  type Segment,
} from "oxalis/store";

const convertCellIdToCSS = (id: number, mappingColors) => {
  const [h, s, l, a] = jsConvertCellIdToHSLA(id, mappingColors);
  return `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
};

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

const getLoadPrecomputedMeshMenuItem = (
  segment: Segment,
  currentMeshFile,
  loadPrecomputedMeshForSegment,
  andCloseContextMenu,
) => {
  const hasCurrentMeshFile = currentMeshFile != null;

  return (
    <Menu.Item
      onClick={() => andCloseContextMenu(loadPrecomputedMeshForSegment(segment))}
      disabled={!hasCurrentMeshFile}
    >
      <Tooltip
        key="tooltip"
        title={
          currentMeshFile != null
            ? `Load mesh for centered segment from file ${currentMeshFile}`
            : "There is no mesh file."
        }
      >
        Load Mesh (precomputed)
      </Tooltip>
    </Menu.Item>
  );
};

const getComputeMeshAdHocMenuItem = (
  segment,
  changeActiveIsosurfaceId,
  isSegmentationLayerVisible,
  andCloseContextMenu,
) => {
  const { disabled, title } = getComputeMeshAdHocTooltipInfo(false, isSegmentationLayerVisible);
  return (
    <Menu.Item
      onClick={() =>
        andCloseContextMenu(changeActiveIsosurfaceId(segment.id, segment.somePosition, true))
      }
      disabled={disabled}
    >
      <Tooltip title={title}>Compute Mesh (ad hoc)</Tooltip>
    </Menu.Item>
  );
};

type Props = {
  segment: Segment,
  mapId: number => number,
  isJSONMappingEnabled: boolean,
  mappingInfo: ActiveMappingInfo,
  hoveredSegmentId: ?number,
  centeredSegmentId: ?number,
  selectedSegmentId: ?number,
  activeCellId: ?number,
  setHoveredSegmentId: (?number) => void,
  handleSegmentDropdownMenuVisibility: (number, boolean) => void,
  activeDropdownSegmentId: ?number,
  allowUpdate: boolean,
  updateSegment: (number, $Shape<Segment>, string) => void,
  onSelectSegment: Segment => void,
  visibleSegmentationLayer: ?APISegmentationLayer,
  changeActiveIsosurfaceId: (?number, Vector3, boolean) => void,
  isosurface: ?IsosurfaceInformation,
  setPosition: (Vector3, boolean) => void,
  loadPrecomputedMeshForSegment: Segment => Promise<void>,
  currentMeshFile: ?string,
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
  changeActiveIsosurfaceId,
  isosurface,
  setPosition,
  loadPrecomputedMeshForSegment,
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
        loadPrecomputedMeshForSegment,
        andCloseContextMenu,
      )}
      {getComputeMeshAdHocMenuItem(
        segment,
        changeActiveIsosurfaceId,
        visibleSegmentationLayer != null,
        andCloseContextMenu,
      )}
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
      style={{ padding: "2px 5px" }}
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
        overlay={createSegmentContextMenu}
        // The overlay is generated lazily. By default, this would make the overlay
        // re-render on each parent's render() after it was shown for the first time.
        // The reason for this is that it's not destroyed after closing.
        // Therefore, autoDestroy is passed.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        autoDestroy
        placement="bottomCenter"
        visible={activeDropdownSegmentId === segment.id}
        onVisibleChange={isVisible => handleSegmentDropdownMenuVisibility(segment.id, isVisible)}
        trigger={["contextMenu"]}
      >
        <Tooltip title={getSegmentTooltip(segment)}>
          {getColoredDotIconForSegment(mappedId, mappingInfo.mappingColors)}
          <EditableTextLabel
            value={segment.name || `Segment ${segment.id}`}
            label="Segment Name"
            onClick={() => onSelectSegment(segment)}
            onChange={name => {
              if (visibleSegmentationLayer != null) {
                updateSegment(segment.id, { name }, visibleSegmentationLayer.name);
              }
            }}
            horizontalMargin={5}
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
                style={{ marginLeft: 4 }}
              />
            </Tooltip>
          ) : null}
          {segment.id === activeCellId ? (
            <Tooltip title="The currently active segment id belongs to this segment.">
              <i
                className="fas fa-paint-brush deemphasized-segment-name"
                style={{ marginLeft: 4 }}
              />
            </Tooltip>
          ) : null}
        </Tooltip>
      </Dropdown>

      <div style={{ marginLeft: 16 }}>
        <MeshInfoItem
          segment={segment}
          isSelectedInList={segment.id === selectedSegmentId}
          isHovered={segment.id === hoveredSegmentId}
          isosurface={isosurface}
          handleSegmentDropdownMenuVisibility={handleSegmentDropdownMenuVisibility}
          changeActiveIsosurfaceId={changeActiveIsosurfaceId}
          visibleSegmentationLayer={visibleSegmentationLayer}
          setPosition={setPosition}
        />
      </div>
    </List.Item>
  );
}
const SegmentListItem = React.memo<Props>(_SegmentListItem);

function _MeshInfoItem(props: {
  segment: Segment,
  isSelectedInList: boolean,
  isHovered: boolean,
  isosurface: ?IsosurfaceInformation,
  handleSegmentDropdownMenuVisibility: (number, boolean) => void,
  visibleSegmentationLayer: ?APISegmentationLayer,
  changeActiveIsosurfaceId: (?number, Vector3, boolean) => void,
  setPosition: (Vector3, boolean) => void,
}) {
  const dispatch = useDispatch();
  const onChangeMeshVisibility = (layerName: string, id: number, isVisible: boolean) => {
    dispatch(updateIsosurfaceVisibilityAction(layerName, id, isVisible));
  };

  const { segment, isSelectedInList, isHovered, isosurface } = props;
  const deemphasizedStyle = { fontStyle: "italic", color: "#989898" };
  if (!isosurface) {
    if (isSelectedInList) {
      return (
        <div
          style={{ ...deemphasizedStyle, marginLeft: 8 }}
          onContextMenu={evt => {
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
        onClick={() => Store.dispatch(triggerIsosurfaceDownloadAction(segment.id))}
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
          // reset the active mesh id so the deleted one is not reloaded immediately
          props.changeActiveIsosurfaceId(0, [0, 0, 0], false);
        }}
      />
    </Tooltip>
  );

  const toggleVisibilityCheckbox = (
    <Tooltip title="Change visibility">
      <Checkbox
        checked={isVisible}
        onChange={(event: SyntheticInputEvent<>) => {
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
      <div style={{ display: "flex" }}>
        <div
          className={classnames("segment-list-item", {
            "is-selected-cell": isSelectedInList,
          })}
        >
          {toggleVisibilityCheckbox}
          <span
            onClick={() => {
              props.changeActiveIsosurfaceId(segment.id, seedPosition, !isPrecomputed);
              props.setPosition(seedPosition, false);
            }}
            style={{ ...textStyle, marginLeft: 8 }}
          >
            {isPrecomputed ? "Mesh (precomputed)" : "Mesh (ad-hoc computed)"}
          </span>
        </div>
        <div style={{ visibility: actionVisibility, marginLeft: 6 }}>
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
  visibleSegmentationLayer: ?APISegmentationLayer,
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
