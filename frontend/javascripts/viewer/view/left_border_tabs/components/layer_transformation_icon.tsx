import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import type { APIDataLayer, APISkeletonLayer } from "types/api_types";
import { IdentityTransform } from "viewer/constants";
import {
  getTransformsForLayer,
  getTransformsForLayerOrNull,
  hasDatasetTransforms,
  isLayerWithoutTransformationConfigSupport,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getNewPositionAndZoomChangeFromTransformationChange } from "viewer/model/accessors/flycam_accessor";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { updateDatasetSettingAction } from "viewer/model/actions/settings_actions";
import { Store } from "viewer/singletons";
import ButtonComponent from "viewer/view/components/button_component";

export default function LayerTransformationIcon({
  layer,
}: {
  layer: APIDataLayer | APISkeletonLayer;
}) {
  const dispatch = useDispatch();
  const transform = useWkSelector((state) =>
    getTransformsForLayerOrNull(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    ),
  );
  const canLayerHaveTransforms = !isLayerWithoutTransformationConfigSupport(layer);
  const hasLayerTransformsConfigured = useWkSelector(
    (state) => getTransformsForLayerOrNull(state.dataset, layer, null) != null,
  );

  const showIcon = useWkSelector((state) => hasDatasetTransforms(state.dataset));
  if (!showIcon) {
    return null;
  }
  const isRenderedNatively = transform == null || transform === IdentityTransform;

  const typeToLabel = {
    affine: "an affine",
    thin_plate_spline: "a thin-plate-spline",
  };

  const typeToImage = {
    none: "icon-no-transformation.svg",
    thin_plate_spline: "icon-tps-transformation.svg",
    affine: "icon-affine-transformation.svg",
  };

  // Cannot toggle transforms for a layer that cannot have no transforms or turn them on in case the layer has no transforms.
  // Layers that cannot have transformations like skeleton layer and volume tracing layers without fallback
  // automatically copy to the dataset transformation if all other layers have the same transformation.
  const isDisabled =
    !canLayerHaveTransforms || (isRenderedNatively && !hasLayerTransformsConfigured);

  const toggleLayerTransforms = () => {
    const state = Store.getState();
    // Set nativelyRenderedLayerName to null in case the current layer is already natively rendered or does not have its own transformations configured (e.g. a skeleton layer) .
    const nextNativelyRenderedLayerName = isRenderedNatively ? null : layer.name;
    const activeTransformation = getTransformsForLayer(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    );
    const nextTransform = getTransformsForLayer(
      state.dataset,
      layer,
      nextNativelyRenderedLayerName,
    );
    const { scaleChange, newPosition } = getNewPositionAndZoomChangeFromTransformationChange(
      activeTransformation,
      nextTransform,
      state,
    );
    dispatch(
      updateDatasetSettingAction("nativelyRenderedLayerName", nextNativelyRenderedLayerName),
    );
    dispatch(setPositionAction(newPosition));
    dispatch(setZoomStepAction(state.flycam.zoomStep * scaleChange));
  };

  return (
    <ButtonComponent
      variant="text"
      color="default"
      size="small"
      onClick={toggleLayerTransforms}
      disabled={isDisabled}
      title={
        isRenderedNatively
          ? `This layer is shown natively (i.e., without any transformations).${isDisabled ? "" : " Click to render this layer with its configured transforms."}`
          : `This layer is rendered with ${
              typeToLabel[transform.type]
            } transformation.${isDisabled ? "" : " Click to render this layer without any transforms."}`
      }
      icon={
        <img
          src={`/assets/images/${typeToImage[isRenderedNatively ? "none" : transform.type]}`}
          alt="Transformed Layer Icon"
          style={{ width: "0.9em", height: "0.9em", marginTop: "-3px" }}
        />
      }
    />
  );
}
