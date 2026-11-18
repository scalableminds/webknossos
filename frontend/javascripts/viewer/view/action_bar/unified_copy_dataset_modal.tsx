// Unified datasets prototype: the viewer's "Copy dataset" modal, fed from the store.
import CopyDatasetModal, {
  type CopyDatasetModalAnnotationLayer,
  type CopyDatasetModalDataset,
} from "admin/dataset/copy_dataset_modal";
import { useWkSelector } from "libs/react_hooks";
import { getUrlParamsObject } from "libs/utils";
import { useMemo } from "react";
import { useDispatch } from "react-redux";
import { UserThemeConfigProvider } from "theme_provider";
import { isBackingAnnotationLoaded } from "viewer/model/accessors/unified_dataset_accessor";
import { setCopyDatasetModalVisibilityAction } from "viewer/model/actions/ui_actions";

export default function UnifiedCopyDatasetModal() {
  const dispatch = useDispatch();
  const isOpen = useWkSelector((state) => state.uiInformation.showCopyDatasetModal);
  const datasetId = useWkSelector((state) => state.dataset.id);
  const datasetName = useWkSelector((state) => state.dataset.name);
  const dataLayers = useWkSelector((state) => state.dataset.dataSource.dataLayers);
  const isBackingAnnotation = useWkSelector(isBackingAnnotationLoaded);
  const annotationLayerDescriptors = useWkSelector((state) => state.annotation.annotationLayers);

  const dataset: CopyDatasetModalDataset = useMemo(
    () => ({ id: datasetId, name: datasetName, dataLayerNames: dataLayers.map((l) => l.name) }),
    [datasetId, datasetName, dataLayers],
  );
  const annotationLayers: CopyDatasetModalAnnotationLayer[] = useMemo(
    () =>
      isBackingAnnotation
        ? annotationLayerDescriptors.map((layer) => ({ name: layer.name, typ: layer.typ }))
        : [],
    [isBackingAnnotation, annotationLayerDescriptors],
  );

  return (
    <UserThemeConfigProvider>
      <CopyDatasetModal
        dataset={dataset}
        annotationLayers={annotationLayers}
        sharingToken={getUrlParamsObject().token}
        isOpen={isOpen}
        onClose={() => dispatch(setCopyDatasetModalVisibilityAction(false))}
      />
    </UserThemeConfigProvider>
  );
}
