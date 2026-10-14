import { Flex } from "antd";
import { useState } from "react";
import type { VoxelSize } from "types/api_types";
import {
  getLandmarkPairs,
  getMeanResidual,
  isCompletePair,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  type Side,
} from "../helpers/layer_registration_helpers";
import type { CopySource, MovingLayerRow } from "../helpers/layer_registration_moving_layers";
import { getNextStep } from "../helpers/layer_registration_next_step";
import type { TransformEstimation } from "../helpers/layer_registration_transform_estimation";
import type { SaveState } from "../layer_registration_protocol";
import type { ViewSettings } from "../workspace/hooks/use_layer_registration_view_settings";
import type { LandmarkExportFormat } from "../workspace/layer_registration_landmark_export";
import { MovingLayerSelect } from "./layer_registration_moving_layer_select";
import { LandmarkPairSection } from "./layer_registration_pair_table";
import { LayerRegistrationPanelFooter } from "./layer_registration_panel_footer";
import { LayerRegistrationPanelHeader } from "./layer_registration_panel_header";
import { TransformStatusCard } from "./layer_registration_status_card";

type Props = {
  annotationName: string;
  annotationDescription: string;
  onChangeAnnotationName: (name: string) => void;
  onChangeAnnotationDescription: (description: string) => void;
  layerNames: LayerNames;
  // The voxel size of the dataset, to show the errors of the pairs as lengths.
  voxelSize: VoxelSize;
  landmarks: Record<Side, Landmark[]>;
  // The transform estimation of the active moving layer.
  estimation: TransformEstimation;
  viewSettings: ViewSettings;
  canApplyTransformToDataset: boolean;
  onApplyTransformToDataset: () => void;
  // One row per moving layer. The moving layer can only be switched if there is more than one.
  movingLayerRows: MovingLayerRow[];
  onSelectMovingLayer: (layerName: string) => void;
  // Moving layers whose fixed layer landmarks can be copied while there are no landmarks yet.
  copySources: CopySource[];
  onCopyLandmarks: (sourceLayerName: string) => Promise<void>;
  onSelectPair: (pair: LandmarkPair) => void;
  onDeletePair: (pair: LandmarkPair) => void;
  onDownloadLandmarks: (format: LandmarkExportFormat) => void;
  // The page that lists the layer registrations of the dataset.
  layerRegistrationListUrl: string;
  // Whether the layer registration annotation is saved, being saved or has unsaved changes.
  saveState: SaveState;
  onSave: () => Promise<void>;
};

function getApplyDisabledReason(
  canApplyTransformToDataset: boolean,
  hasTransform: boolean,
): string | null {
  if (!canApplyTransformToDataset) {
    return "You don't have the permission to edit this dataset.";
  }
  return hasTransform ? null : "Place at least three landmark pairs to get a transform first.";
}

/** The panel right of the two views. From top to bottom, its parts belong to the whole layer
 * registration annotation (header), to the choice of the active moving layer, to the transform of
 * the active moving layer (status card and landmark pairs), and to the views (footer).
 */
export function LayerRegistrationLandmarkPanel({
  annotationName,
  annotationDescription,
  onChangeAnnotationName,
  onChangeAnnotationDescription,
  layerNames,
  voxelSize,
  landmarks,
  estimation,
  viewSettings,
  canApplyTransformToDataset,
  onApplyTransformToDataset,
  movingLayerRows,
  onSelectMovingLayer,
  copySources,
  onCopyLandmarks,
  onSelectPair,
  onDeletePair,
  onDownloadLandmarks,
  layerRegistrationListUrl,
  saveState,
  onSave,
}: Props) {
  const estimatedTransform = "errorMessage" in estimation ? null : estimation;
  const pairs = getLandmarkPairs(
    landmarks,
    estimatedTransform?.movingToFixedTransform ?? null,
    voxelSize.factor,
  );
  const meanResidual = getMeanResidual(pairs);
  // The pair that was selected last, highlighted in the table.
  const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
  const selectPair = (pair: LandmarkPair) => {
    setSelectedPairKey(pair.key);
    onSelectPair(pair);
  };
  const nextStep = getNextStep({
    pairs,
    hasTransform: estimatedTransform != null,
    meanResidual,
    voxelSizeFactor: voxelSize.factor,
    movingLayerRows,
    activeLayerName: layerNames.moving,
  });

  return (
    <Flex vertical style={{ height: "100%" }}>
      <LayerRegistrationPanelHeader
        name={annotationName}
        description={annotationDescription}
        onChangeName={onChangeAnnotationName}
        onChangeDescription={onChangeAnnotationDescription}
        saveState={saveState}
        onSave={onSave}
        canDownloadLandmarks={pairs.some(isCompletePair)}
        onDownloadLandmarks={onDownloadLandmarks}
        layerRegistrationListUrl={layerRegistrationListUrl}
      />
      <MovingLayerSelect
        rows={movingLayerRows}
        activeLayerName={layerNames.moving}
        fixedLayerName={layerNames.fixed}
        voxelSize={voxelSize}
        onSelect={onSelectMovingLayer}
      />
      <TransformStatusCard
        pairs={pairs}
        estimation={estimation}
        meanResidual={meanResidual}
        voxelSize={voxelSize}
        nextStep={nextStep}
        onSelectPair={selectPair}
        onSelectMovingLayer={onSelectMovingLayer}
      />
      <LandmarkPairSection
        pairs={pairs}
        layerNames={layerNames}
        voxelSize={voxelSize}
        meanResidual={meanResidual}
        selectedPairKey={selectedPairKey}
        onSelectPair={selectPair}
        onDeletePair={onDeletePair}
        copySources={copySources}
        onCopyLandmarks={onCopyLandmarks}
      />
      <LayerRegistrationPanelFooter
        layerNames={layerNames}
        isTransformAvailable={estimatedTransform != null}
        viewSettings={viewSettings}
        applyDisabledReason={getApplyDisabledReason(
          canApplyTransformToDataset,
          estimatedTransform != null,
        )}
        onApplyTransformToDataset={onApplyTransformToDataset}
      />
    </Flex>
  );
}
