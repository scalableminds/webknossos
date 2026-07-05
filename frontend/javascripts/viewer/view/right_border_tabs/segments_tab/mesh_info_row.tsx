import {
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { Checkbox } from "antd";
import type { CheckboxChangeEvent } from "antd/lib/checkbox/Checkbox";
import classnames from "classnames";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { memo } from "react";
import { useDispatch } from "react-redux";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import {
  refreshMeshAction,
  removeMeshAction,
  triggerMeshDownloadAction,
  updateMeshVisibilityAction,
} from "viewer/model/actions/annotation_actions";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "viewer/model/actions/flycam_actions";
import type { MeshInformation, Segment } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";

type Props = {
  segment: Segment;
  mesh: MeshInformation | null | undefined;
  isSelectedInList: boolean;
  isHovered: boolean;
};

/*
 * Info line below a segment entry that shows whether a mesh is loaded for it
 * and provides mesh-related quick actions (toggle, jump to seed, refresh,
 * download, remove).
 */
export const MeshInfoRow = memo(({ segment, mesh, isSelectedInList, isHovered }: Props) => {
  const dispatch = useDispatch();
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);

  if (
    mesh == null ||
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

  const withLayer = (callback: (layerName: string) => void) => {
    if (visibleSegmentationLayer != null) {
      callback(visibleSegmentationLayer.name);
    }
  };

  const { seedPosition, seedAdditionalCoordinates, isLoading, isPrecomputed, isVisible } = mesh;

  return (
    <div style={{ padding: 0, cursor: "pointer", display: "flex" }}>
      <div
        className={classnames("segment-list-item", {
          "is-selected-segment": isSelectedInList,
        })}
      >
        <FastTooltip title="Change visibility of mesh">
          <Checkbox
            checked={isVisible}
            onChange={(event: CheckboxChangeEvent) =>
              withLayer((layerName) =>
                dispatch(
                  updateMeshVisibilityAction(
                    layerName,
                    segment.id,
                    event.target.checked,
                    seedAdditionalCoordinates,
                  ),
                ),
              )
            }
          />
        </FastTooltip>
        <span
          className={isVisible ? "" : "deemphasized italic"}
          style={{ marginLeft: 8 }}
          onClick={() => {
            dispatch(setPositionAction(seedPosition));
            if (seedAdditionalCoordinates) {
              dispatch(setAdditionalCoordinatesAction(seedAdditionalCoordinates));
            }
          }}
        >
          {isPrecomputed ? "Mesh (precomputed)" : "Mesh (ad-hoc computed)"}
        </span>
      </div>
      <div style={{ visibility: isLoading || isHovered ? "visible" : "hidden", marginLeft: 6 }}>
        <ButtonComponent
          color="default"
          type="text"
          size="small"
          title="Refresh Mesh"
          disabled={isLoading}
          icon={isLoading ? <LoadingOutlined /> : <ReloadOutlined />}
          onClick={() =>
            withLayer((layerName) => dispatch(refreshMeshAction(layerName, segment.id)))
          }
        />
        <ButtonComponent
          color="default"
          type="text"
          size="small"
          title="Download Mesh"
          icon={<VerticalAlignBottomOutlined />}
          onClick={() =>
            withLayer((layerName) =>
              dispatch(triggerMeshDownloadAction(segment.name ?? "mesh", segment.id, layerName)),
            )
          }
        />
        <ButtonComponent
          color="default"
          type="text"
          size="small"
          title="Remove Mesh"
          icon={<DeleteOutlined />}
          onClick={() =>
            withLayer((layerName) => dispatch(removeMeshAction(layerName, segment.id)))
          }
        />
      </div>
    </div>
  );
});
