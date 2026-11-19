// Unified datasets prototype (B5): removing a data layer from a virtual dataset.
import { removeDataLayer } from "admin/api/unified_datasets";
import { Modal } from "antd";
import Toast from "libs/toast";
import { Model } from "viewer/singletons";

export function removeDataLayerIfConfirmed(datasetId: string, layerName: string) {
  Modal.confirm({
    title: `Remove the data layer ${layerName}?`,
    content:
      "The layer is removed from this dataset only. Its data is kept as long as other datasets use it.",
    okText: "Remove",
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await Model.ensureSavedState();
        await removeDataLayer(datasetId, layerName);
        // The data source changes, so the viewer has to be set up again.
        location.reload();
      } catch (error) {
        Toast.error(`Could not remove the data layer ${layerName}.`);
        console.error(error);
      }
    },
  });
}
