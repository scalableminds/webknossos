import { Modal, Row } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type React from "react";
import { useMemo, useState } from "react";
import _ from "lodash";
import type { APIDataset, APISegmentationLayer } from "types/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import {
  NewVolumeLayerSelection,
  RestrictMagnificationSlider,
} from "dashboard/advanced_dataset/create_explorative_modal";
import Store, { type Tracing } from "oxalis/store";
import { addAnnotationLayer } from "admin/admin_rest_api";
import {
  getSomeMagInfoForDataset,
  getLayerByName,
  getMappingInfo,
  getSegmentationLayers,
  getMagInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getAllReadableLayerNames,
  getVolumeTracingLayers,
} from "oxalis/model/accessors/volumetracing_accessor";
import messages from "messages";
import InputComponent from "oxalis/view/components/input_component";
import { api } from "oxalis/singletons";
import Toast from "libs/toast";
import { MappingStatusEnum } from "oxalis/constants";

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
  // A layer name is not allowed to start with a dot.
  if (readableLayerName.startsWith(".")) {
    return {
      isValid: false,
      message: messages["tracing.volume_layer_name_starts_with_dot"],
    };
  }
  const uriSafeCharactersRegex = /[0-9a-zA-Z-._$]+/g;
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
  if (readableLayerName.length < 1) {
    return {
      isValid: false,
      message: messages["tracing.volume_layer_name_too_short"],
    };
  }
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
  preselectedLayerName,
  disableLayerSelection,
}: {
  dataset: APIDataset;
  onCancel: () => void;
  tracing: Tracing;
  preselectedLayerName: string | undefined;
  disableLayerSelection: boolean | undefined;
}) {
  const [selectedSegmentationLayerName, setSelectedSegmentationLayerName] = useState<
    string | undefined
  >(preselectedLayerName);
  const allReadableLayerNames = useMemo(
    () => getAllReadableLayerNames(dataset, tracing),
    [dataset, tracing],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Needs investigation whether to add more dependencies.
  const initialNewLayerName = useMemo(() => {
    if (preselectedLayerName) {
      return preselectedLayerName;
    }
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
  const selectedSegmentationLayer =
    selectedSegmentationLayerName != null
      ? (getLayerByName(dataset, selectedSegmentationLayerName) as APISegmentationLayer)
      : null;
  const [newLayerName, setNewLayerName] = useState(initialNewLayerName);

  const magInfo =
    selectedSegmentationLayer == null
      ? getSomeMagInfoForDataset(dataset)
      : getMagInfo(selectedSegmentationLayer.resolutions);
  const [magIndices, setMagIndices] = useState([0, 10000]);

  const handleSetNewLayerName = (evt: React.ChangeEvent<HTMLInputElement>) =>
    setNewLayerName(evt.target.value);

  const segmentationLayers = getSegmentationLayers(dataset);
  const volumeTracingLayers = getVolumeTracingLayers(dataset);

  const availableSegmentationLayers = _.differenceWith(segmentationLayers, volumeTracingLayers);

  const handleAddVolumeLayer = async () => {
    await api.tracing.save();
    const validationResult = validateReadableLayerName(
      newLayerName,
      allReadableLayerNames,
      selectedSegmentationLayerName,
    );
    if (!validationResult.isValid) {
      Toast.error(validationResult.message);
      return;
    }
    const minMagAllowed = Math.max(...magInfo.getMagByIndexOrThrow(magIndices[0]));
    const maxMagAllowed = Math.max(...magInfo.getMagByIndexOrThrow(magIndices[1]));

    if (selectedSegmentationLayerName == null) {
      await addAnnotationLayer(tracing.annotationId, tracing.annotationType, {
        typ: "Volume",
        name: newLayerName,
        fallbackLayerName: undefined,
        magRestrictions: {
          min: minMagAllowed,
          max: maxMagAllowed,
        },
      });
    } else {
      if (selectedSegmentationLayer == null) {
        throw new Error("Segmentation layer is null");
      }
      const fallbackLayerName = selectedSegmentationLayer.name;

      const mappingInfo = getMappingInfo(
        Store.getState().temporaryConfiguration.activeMappingByLayer,
        selectedSegmentationLayerName,
      );
      let maybeMappingName = null;
      if (
        mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED &&
        mappingInfo.mappingType === "HDF5"
      ) {
        maybeMappingName = mappingInfo.mappingName;
      }

      await addAnnotationLayer(tracing.annotationId, tracing.annotationType, {
        typ: "Volume",
        name: newLayerName,
        fallbackLayerName,
        magRestrictions: {
          min: minMagAllowed,
          max: maxMagAllowed,
        },
        mappingName: maybeMappingName,
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
      open
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
          selectedSegmentationLayerName={selectedSegmentationLayerName}
          setSelectedSegmentationLayerName={setSelectedSegmentationLayerName}
          disableLayerSelection={disableLayerSelection ?? false}
        />
      ) : null}
      <RestrictMagnificationSlider
        magInfo={magInfo}
        selectedSegmentationLayer={selectedSegmentationLayer}
        magIndices={magIndices}
        setMagIndices={setMagIndices}
      />
      <Row justify="center" align="middle">
        <AsyncButton onClick={handleAddVolumeLayer} type="primary" icon={<PlusOutlined />}>
          Add Volume Annotation Layer
        </AsyncButton>
      </Row>
    </Modal>
  );
}
