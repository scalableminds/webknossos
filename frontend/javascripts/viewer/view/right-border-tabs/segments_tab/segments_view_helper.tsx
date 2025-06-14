import { hasSegmentIndexInDataStore } from "admin/rest_api";
import { Modal } from "antd";
import type { BasicDataNode } from "antd/es/tree";
import { waitForCondition } from "libs/utils";
import type { MenuClickEventHandler } from "rc-menu/lib/interface";
import type { APIDataLayer, APIDataset, APISegmentationLayer } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  getEditableMappingForVolumeTracingId,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { setMappingAction, setMappingEnabledAction } from "viewer/model/actions/settings_actions";
import type { ActiveMappingInfo, Segment, StoreAnnotation } from "viewer/store";
import Store from "viewer/store";

const { confirm } = Modal;

export type SegmentHierarchyGroup = BasicDataNode & {
  title: string;
  type: "group";
  name: string | null | undefined;
  id: number;
  key: string;
  isExpanded?: boolean;
  children: Array<SegmentHierarchyNode>;
  // This type does not have an isChecked property, because that will
  // be determined automatically by antd by looking at isChecked of
  // the children.
};

export type SegmentHierarchyLeaf = BasicDataNode &
  Segment & {
    type: "segment";
    key: string;
    title: string;
    children?: undefined;
    isChecked: boolean;
  };

export type SegmentHierarchyNode = SegmentHierarchyLeaf | SegmentHierarchyGroup;

export function getBaseSegmentationName(segmentationLayer: APIDataLayer) {
  return (
    ("fallbackLayer" in segmentationLayer ? segmentationLayer.fallbackLayer : null) ||
    segmentationLayer.name
  );
}

export function getVolumeRequestUrl(
  dataset: APIDataset,
  annotation: StoreAnnotation | null,
  tracingId: string | undefined,
  visibleSegmentationLayer: APISegmentationLayer | APIDataLayer,
) {
  if (annotation == null || tracingId == null) {
    return `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${dataset.directoryName}/layers/${visibleSegmentationLayer.name}`;
  } else {
    const tracingStoreHost = annotation?.tracingStore.url;
    return `${tracingStoreHost}/tracings/volume/${tracingId}`;
  }
}

export async function hasSegmentIndex(
  visibleSegmentationLayer: APIDataLayer,
  dataset: APIDataset,
  annotation: StoreAnnotation | null | undefined,
) {
  const maybeVolumeTracing =
    "tracingId" in visibleSegmentationLayer &&
    visibleSegmentationLayer.tracingId != null &&
    annotation != null
      ? getVolumeTracingById(annotation, visibleSegmentationLayer.tracingId)
      : null;
  let segmentIndexInDataStore = false;
  if (maybeVolumeTracing == null) {
    segmentIndexInDataStore = await hasSegmentIndexInDataStore(
      dataset.dataStore.url,
      dataset.directoryName,
      visibleSegmentationLayer.name,
      dataset.owningOrganization,
    );
  }
  return (
    visibleSegmentationLayer != null &&
    (maybeVolumeTracing?.hasSegmentIndex || segmentIndexInDataStore)
  );
}

export function withMappingActivationConfirmation(
  originalOnClick: MenuClickEventHandler,
  mappingName: string | null | undefined,
  descriptor: string,
  layerName: string | null | undefined,
  mappingInfo: ActiveMappingInfo,
) {
  const editableMapping = getEditableMappingForVolumeTracingId(Store.getState(), layerName);

  const isMappingEnabled = mappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
  const enabledMappingName = isMappingEnabled ? mappingInfo.mappingName : null;

  // If the mapping name is undefined, no mapping is specified. In that case never show the activation modal.
  // In contrast, if the mapping name is null, this indicates that all mappings should be specifically disabled.
  if (mappingName === undefined || layerName == null || mappingName === enabledMappingName) {
    return originalOnClick;
  }

  const actionStr = editableMapping == null ? "will" : "cannot";
  const mappingString =
    mappingName != null
      ? `for the mapping "${mappingName}" which is not active. The mapping ${actionStr} be activated`
      : `without a mapping but a mapping is active. The mapping ${actionStr} be deactivated`;
  const recommendationStr =
    editableMapping == null
      ? ""
      : "This is because the current mapping was locked while editing it with the proofreading tool. Consider changing the active mesh file instead.";

  const confirmMappingActivation: MenuClickEventHandler = (menuClickEvent) => {
    confirm({
      title: `The currently active ${descriptor} was computed ${mappingString} when clicking OK. ${recommendationStr}`,
      async onOk() {
        if (editableMapping != null) {
          return;
        }
        if (mappingName != null) {
          Store.dispatch(setMappingAction(layerName, mappingName, "HDF5"));
          await waitForCondition(
            () =>
              getMappingInfo(
                Store.getState().temporaryConfiguration.activeMappingByLayer,
                layerName,
              ).mappingStatus === MappingStatusEnum.ENABLED,
            100,
          );
        } else {
          Store.dispatch(setMappingEnabledAction(layerName, false));
          await waitForCondition(
            () =>
              getMappingInfo(
                Store.getState().temporaryConfiguration.activeMappingByLayer,
                layerName,
              ).mappingStatus === MappingStatusEnum.DISABLED,
            100,
          );
        }

        originalOnClick(menuClickEvent);
      },
    });
  };

  return confirmMappingActivation;
}
