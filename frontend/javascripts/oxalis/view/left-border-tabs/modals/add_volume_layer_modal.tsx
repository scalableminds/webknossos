import { Modal, Row } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import React, { useMemo, useState } from "react";
import _ from "lodash";
import type { APIDataset } from "types/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import {
  NewVolumeLayerSelection,
  RestrictResolutionSlider,
} from "dashboard/advanced_dataset/create_explorative_modal";
import type { Tracing } from "oxalis/store";
import { addAnnotationLayer } from "admin/admin_rest_api";
import {
  getDatasetResolutionInfo,
  getSegmentationLayers,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getAllReadableLayerNames,
  getVolumeTracingLayers,
} from "oxalis/model/accessors/volumetracing_accessor";
import messages from "messages";
import InputComponent from "oxalis/view/components/input_component";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";

export type ValidationResult = { isValid: boolean; message: string };
export function checkForLayerNameDuplication(
  readableLayerName: string,
  allReadableLayerNames: string[],
): ValidationResult {
  const layerNameDoesNotExist = !allReadableLayerNames.includes(readableLayerName);
  return {
    isValid: layerNameDoesNotExist,
    message: layerNameDoesNotExist ? "" : messages["tracing.volume_layer_name_duplication"],
  };
}

export function checkLayerNameForInvalidCharacters(readableLayerName: string): ValidationResult {
  const uriSafeCharactersRegex = /[0-9a-zA-Z-._]+/g;
  // Removing all URISaveCharacters from readableLayerName. The leftover chars are all invalid.
  const allInvalidChars = readableLayerName.replace(uriSafeCharactersRegex, "");
  const allUniqueInvalidCharsAsSet = new Set(allInvalidChars);
  const allUniqueInvalidCharsAsString = "".concat(...allUniqueInvalidCharsAsSet.values());
  const isValid = allUniqueInvalidCharsAsString.length === 0;
  return {
    isValid,
    message: isValid
      ? ""
      : messages["tracing.volume_layer_name_includes_invalid_characters"](
          allUniqueInvalidCharsAsString,
        ),
  };
}

export function validateReadableLayerName(
  readableLayerName: string,
  allReadableLayerNames: string[],
  nameNotToCount?: string,
): ValidationResult {
  if (nameNotToCount) {
    // nameNotToCount needs to be removed once if it is included in allReadableLayerNames.
    // This is needed in case of saving an existing volume layer's name when the name was not modified.
    // In this scenario nameNotToCount should be the previous name of the volume layer which will then be removed once from the allReadableLayerNames.
    // Thus there is only a duplication of the given nameNotToCount if an additional other layer already has nameNotToCount as a name
    // and the readableLayerName is equal to the name given by nameNotToCount.
    const index = allReadableLayerNames.indexOf(nameNotToCount);
    if (index > -1) {
      allReadableLayerNames = _.clone(allReadableLayerNames); // Avoiding modifying passed parameters.
      allReadableLayerNames.splice(index, 1);
    }
  }
  const duplicatedNameResult = checkForLayerNameDuplication(
    readableLayerName,
    allReadableLayerNames,
  );
  if (!duplicatedNameResult.isValid) {
    return duplicatedNameResult;
  }
  const invalidCharactersResult = checkLayerNameForInvalidCharacters(readableLayerName);
  return invalidCharactersResult;
}

export default function AddVolumeLayerModal({
  dataset,
  onCancel,
  tracing,
}: {
  dataset: APIDataset;
  onCancel: () => void;
  tracing: Tracing;
}) {
  const [selectedSegmentationLayerIndex, setSelectedSegmentationLayerIndex] = useState<
    number | null | undefined
  >(null);
  const allReadableLayerNames = useMemo(
    () => getAllReadableLayerNames(dataset, tracing),
    [dataset, tracing],
  );
  const initialNewLayerName = useMemo(() => {
    if (allReadableLayerNames.indexOf("Volume") === -1) {
      return "Volume";
    } else {
      let counter = 1;
      let name = `Volume${counter}`;
      while (allReadableLayerNames.indexOf(name) >= 0) {
        // Increase number at the end of name until a valid initial name is found.
        ++counter;
        name = `Volume${counter}`;
      }
      return name;
    }
  }, [dataset, tracing]);
  const [newLayerName, setNewLayerName] = useState(initialNewLayerName);

  const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
  const [resolutionIndices, setResolutionIndices] = useState([0, 10000]);

  const handleSetNewLayerName = (evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setNewLayerName(evt.target.value);

  const segmentationLayers = getSegmentationLayers(dataset);
  const volumeTracingLayers = getVolumeTracingLayers(dataset);

  const availableSegmentationLayers = _.differenceWith(segmentationLayers, volumeTracingLayers);
  let selectedSegmentationLayer = null;
  const handleAddVolumeLayer = async () => {
    await api.tracing.save();
    const validationResult = validateReadableLayerName(newLayerName, allReadableLayerNames);
    if (!validationResult.isValid) {
      Toast.error(validationResult.message);
      return;
    }
    const minResolutionAllowed = Math.max(
      ...datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndices[0]),
    );
    const maxResolutionAllowed = Math.max(
      ...datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndices[1]),
    );

    if (selectedSegmentationLayerIndex == null) {
      await addAnnotationLayer(tracing.annotationId, tracing.annotationType, {
        typ: "Volume",
        name: newLayerName,
        fallbackLayerName: undefined,
        resolutionRestrictions: {
          min: minResolutionAllowed,
          max: maxResolutionAllowed,
        },
      });
    } else {
      selectedSegmentationLayer = availableSegmentationLayers[selectedSegmentationLayerIndex];
      const fallbackLayerName = selectedSegmentationLayer.name;
      await addAnnotationLayer(tracing.annotationId, tracing.annotationType, {
        typ: "Volume",
        name: newLayerName,
        fallbackLayerName,
        resolutionRestrictions: {
          min: minResolutionAllowed,
          max: maxResolutionAllowed,
        },
      });
    }

    await api.tracing.hardReload();
  };

  return (
    <Modal
      title="Add Volume Annotation Layer"
      footer={null}
      width={500}
      maskClosable={false}
      onCancel={onCancel}
      visible
    >
      Layer Name:{" "}
      <InputComponent
        size="small"
        onChange={handleSetNewLayerName}
        value={newLayerName}
        style={{
          width: "60%",
          marginBottom: 16,
          marginLeft: 8,
        }}
      />
      {availableSegmentationLayers.length > 0 ? (
        <NewVolumeLayerSelection
          dataset={dataset}
          segmentationLayers={availableSegmentationLayers}
          selectedSegmentationLayerIndex={selectedSegmentationLayerIndex}
          setSelectedSegmentationLayerIndex={setSelectedSegmentationLayerIndex}
        />
      ) : null}
      <RestrictResolutionSlider
        datasetResolutionInfo={datasetResolutionInfo}
        selectedSegmentationLayer={selectedSegmentationLayer}
        resolutionIndices={resolutionIndices}
        setResolutionIndices={setResolutionIndices}
      />
      <Row justify="center" align="middle">
        <AsyncButton onClick={handleAddVolumeLayer} type="primary" icon={<PlusOutlined />}>
          Add Volume Annotation Layer
        </AsyncButton>
      </Row>
    </Modal>
  );
}
