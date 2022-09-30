import type { ComponentType } from "react";
import React from "react";
import { Modal } from "antd";
import { getMeshfilesForDatasetLayer } from "admin/admin_rest_api";
import type { APIDataset, APIDataLayer, APIMeshFile } from "types/api_flow_types";
import type { ActiveMappingInfo } from "oxalis/store";
import Store from "oxalis/store";
import {
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import { MappingStatusEnum } from "oxalis/constants";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import { waitForCondition } from "libs/utils";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";

const { confirm } = Modal;

export function getBaseSegmentationName(segmentationLayer: APIDataLayer) {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'fallbackLayer' does not exist on type 'A... Remove this comment to see the full error message
  return segmentationLayer.fallbackLayer || segmentationLayer.name;
}
export async function maybeFetchMeshFiles(
  segmentationLayer: APIDataLayer | null | undefined,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
): Promise<Array<APIMeshFile>> {
  if (!segmentationLayer) {
    return [];
  }

  const layerName = segmentationLayer.name;
  const files = Store.getState().localSegmentationData[layerName].availableMeshFiles;

  // Only send new get request, if it hasn't happened before (files in store are null)
  // else return the stored files (might be empty array). Or if we force a reload.
  if (!files || mustRequest) {
    const availableMeshFiles = await getMeshfilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
    );
    Store.dispatch(updateMeshFileListAction(layerName, availableMeshFiles));

    if (
      !Store.getState().localSegmentationData[layerName].currentMeshFile &&
      availableMeshFiles.length > 0 &&
      autoActivate
    ) {
      Store.dispatch(updateCurrentMeshFileAction(layerName, availableMeshFiles[0].meshFileName));
    }

    return availableMeshFiles;
  }

  return files;
}

type MappingActivationConfirmationProps<R> = R & {
  mappingName: string | null | undefined;
  descriptor: string;
  layerName: string | null | undefined;
  mappingInfo: ActiveMappingInfo;
  onClick: (...args: Array<any>) => any;
};
export function withMappingActivationConfirmation<P, C extends ComponentType<P>>(
  WrappedComponent: C,
): ComponentType<MappingActivationConfirmationProps<P>> {
  return function ComponentWithMappingActivationConfirmation(
    props: MappingActivationConfirmationProps<P>,
  ) {
    const {
      mappingName,
      descriptor,
      layerName,
      mappingInfo,
      onClick: originalOnClick,
      ...rest
    } = props;

    const isMappingEnabled = mappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
    const enabledMappingName = isMappingEnabled ? mappingInfo.mappingName : null;

    // If the mapping name is undefined, no mapping is specified. In that case never show the activation modal.
    // In contrast, if the mapping name is null, this indicates that all mappings should be specifically disabled.
    if (mappingName === undefined || layerName == null || mappingName === enabledMappingName) {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'Omit<MappingActivationConfirmationProps<P>, ... Remove this comment to see the full error message
      return <WrappedComponent {...rest} onClick={originalOnClick} />;
    }

    const mappingString =
      mappingName != null
        ? `for the mapping "${mappingName}" which is not active. The mapping will be activated`
        : "without a mapping but a mapping is active. The mapping will be deactivated";

    const confirmMappingActivation = () => {
      confirm({
        title: `The currently active ${descriptor} was computed ${mappingString} when clicking OK.`,
        async onOk() {
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

          originalOnClick();
        },
      });
    };

    /* @ts-expect-error ts-migrate(2322) FIXME: Type 'Omit<MappingActivationConfirmationProps<P>, ... Remove this comment to see the full error message */
    return <WrappedComponent {...rest} onClick={confirmMappingActivation} />;
  };
}
