import {
  type UpdateActionWithoutIsolationRequirement,
  updateAnnotationLayerName,
  updateMetadataOfAnnotation,
} from "viewer/model/sagas/volume/update_actions";
import type { StoreAnnotation } from "viewer/store";

export function* diffAnnotationMetadata(
  prevAnnotation: StoreAnnotation,
  annotation: StoreAnnotation,
  mayEditAnnotationProperties: boolean,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevAnnotation === annotation) return;

  if (mayEditAnnotationProperties && prevAnnotation.description !== annotation.description) {
    yield updateMetadataOfAnnotation(annotation.description);
  }

  for (const layer of annotation.annotationLayers) {
    const prevLayer = prevAnnotation.annotationLayers.find((l) => l.tracingId === layer.tracingId);
    if (prevLayer != null && prevLayer.name !== layer.name) {
      yield updateAnnotationLayerName(layer.tracingId, layer.name);
    }
  }
}
