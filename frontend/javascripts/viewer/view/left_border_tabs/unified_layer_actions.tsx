// Buttons below the layer list of the unified datasets prototype (features.unifiedDatasets). They
// replace the "Add ... Annotation Layer" buttons and are only shown to users who may edit the
// dataset's annotation layers.
import { PlusOutlined } from "@ant-design/icons";
import { Button, Divider, Flex } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { isEditingAnnotationLayerSetDisabled } from "viewer/model/accessors/annotation_accessor";
import { mayEditUnifiedDataset } from "viewer/model/accessors/unified_dataset_accessor";
import { pushSaveQueueTransactionIsolated } from "viewer/model/actions/save_actions";
import { addLayerToAnnotation } from "viewer/model/sagas/volume/update_actions";
import { Model } from "viewer/singletons";
import AddLayerFromDatasetModal from "./modals/add_layer_from_dataset_modal";
import AddSkeletonLayerModal from "./modals/add_skeleton_layer_modal";

export const FIXED_DATA_LAYERS_EXPLANATION =
  "This dataset's data layers are fixed. Make a copy to add or remove data layers.";

function useAddSkeletonLayer() {
  const dispatch = useDispatch();
  return async (layerName: string) => {
    dispatch(
      pushSaveQueueTransactionIsolated(
        addLayerToAnnotation({
          typ: "Skeleton",
          name: layerName,
          fallbackLayerName: undefined,
        }),
      ),
    );
    await Model.ensureSavedState();
    location.reload();
  };
}

function AddSkeletonLayerButton({ disabledReason }: { disabledReason: string | null }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const addSkeletonLayer = useAddSkeletonLayer();
  return (
    <>
      <FastTooltip title={disabledReason}>
        <Button
          block
          icon={<PlusOutlined />}
          disabled={disabledReason != null}
          onClick={() => setIsModalOpen(true)}
        >
          Add skeleton layer
        </Button>
      </FastTooltip>
      {isModalOpen ? (
        <AddSkeletonLayerModal onCancel={() => setIsModalOpen(false)} onAdd={addSkeletonLayer} />
      ) : null}
    </>
  );
}

function AddLayerFromDatasetButton({ disabledReason }: { disabledReason: string | null }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  return (
    <>
      <FastTooltip title={disabledReason}>
        <Button
          block
          icon={<PlusOutlined />}
          disabled={disabledReason != null}
          onClick={() => setIsModalOpen(true)}
        >
          Add layer from another dataset
        </Button>
      </FastTooltip>
      {isModalOpen ? <AddLayerFromDatasetModal onCancel={() => setIsModalOpen(false)} /> : null}
    </>
  );
}

export default function UnifiedLayerActions({
  onShowAddVolumeLayerModal,
}: {
  onShowAddVolumeLayerModal: () => void;
}) {
  const mayEdit = useWkSelector(mayEditUnifiedDataset);
  const hasSkeletonLayer = useWkSelector((state) => state.annotation.skeleton != null);
  const isVirtualDataset = useWkSelector((state) => state.dataset.isVirtual);
  const isDatasetEditable = useWkSelector((state) => state.dataset.isEditable);
  const { isDisabled: mayNotEditLayerSet, explanation: reasonForCantEditLayerSet } = useWkSelector(
    (state) => isEditingAnnotationLayerSetDisabled(state),
  );

  if (!mayEdit) {
    return null;
  }

  const layerSetDisabledReason = mayNotEditLayerSet ? reasonForCantEditLayerSet : null;
  const skeletonDisabledReason =
    layerSetDisabledReason ??
    (hasSkeletonLayer ? "This dataset already has a skeleton layer." : null);

  return (
    <>
      <Divider />
      <Flex vertical gap={8} style={{ maxWidth: 260, margin: "0 auto" }}>
        <AddSkeletonLayerButton disabledReason={skeletonDisabledReason} />
        <FastTooltip title={layerSetDisabledReason}>
          <Button
            block
            icon={<PlusOutlined />}
            disabled={layerSetDisabledReason != null}
            onClick={onShowAddVolumeLayerModal}
          >
            Add volume layer
          </Button>
        </FastTooltip>
        <AddLayerFromDatasetButton
          disabledReason={
            !isVirtualDataset
              ? FIXED_DATA_LAYERS_EXPLANATION
              : !isDatasetEditable
                ? "You may not change the data layers of this dataset."
                : null
          }
        />
      </Flex>
    </>
  );
}
