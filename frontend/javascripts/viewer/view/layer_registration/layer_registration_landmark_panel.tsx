import { Flex } from "antd";
import { useState } from "react";
import type { VoxelSize } from "types/api_types";
import {
  type EstimatedTransform,
  getLandmarkPairs,
  getMeanResidual,
  getNextStep,
  isCompletePair,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  type MovingLayerRow,
  type Side,
} from "./layer_registration_helpers";
import type { LandmarkExportFormat } from "./layer_registration_landmark_export";
import { MovingLayerLine } from "./layer_registration_moving_layer_select";
import { type CopySource, LandmarkPairSection } from "./layer_registration_pair_table";
import { LayerRegistrationPanelFooter } from "./layer_registration_panel_footer";
import { LayerRegistrationPanelHeader } from "./layer_registration_panel_header";
import type { SaveState } from "./layer_registration_protocol";
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
  estimatedTransform: EstimatedTransform | null;
  // Why no transform could be estimated, if so.
  estimationErrorMessage: string | null;
  // Per view: whether it also shows the other layer, and whether that layer is transformed.
  isOtherLayerVisible: Record<Side, boolean>;
  onToggleOtherLayer: (side: Side) => void;
  isTransformShown: Record<Side, boolean>;
  onToggleTransform: (side: Side) => void;
  // False if the layers can't be colored, see getOverlayLayerColors.
  canColorOverlay: boolean;
  isColorOverlayEnabled: boolean;
  onColorOverlayChange: (isEnabled: boolean) => void;
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
  estimatedTransform,
  estimationErrorMessage,
  isOtherLayerVisible,
  onToggleOtherLayer,
  isTransformShown,
  onToggleTransform,
  canColorOverlay,
  isColorOverlayEnabled,
  onColorOverlayChange,
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
  const applyDisabledReason = !canApplyTransformToDataset
    ? "You don't have the permission to edit this dataset."
    : estimatedTransform == null
      ? "Place at least three landmark pairs to get a transform first."
      : null;

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
      <MovingLayerLine
        rows={movingLayerRows}
        activeLayerName={layerNames.moving}
        fixedLayerName={layerNames.fixed}
        voxelSize={voxelSize}
        onSelect={onSelectMovingLayer}
      />
      <TransformStatusCard
        pairs={pairs}
        estimatedTransform={estimatedTransform}
        estimationErrorMessage={estimationErrorMessage}
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
        isOtherLayerVisible={isOtherLayerVisible}
        onToggleOtherLayer={onToggleOtherLayer}
        isTransformShown={isTransformShown}
        onToggleTransform={onToggleTransform}
        canColorOverlay={canColorOverlay}
        isColorOverlayEnabled={isColorOverlayEnabled}
        onColorOverlayChange={onColorOverlayChange}
        applyDisabledReason={applyDisabledReason}
        onApplyTransformToDataset={onApplyTransformToDataset}
      />
    </Flex>
  );
}
