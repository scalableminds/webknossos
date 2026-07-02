import { keepPreviousData } from "@tanstack/react-query";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { useCallback, useState } from "react";
import type { APISegmentationLayer } from "types/api_types";
import { getConnectomeDataForLayer } from "viewer/model/accessors/volumetracing_accessor";
import { fetchConnectomeData } from "viewer/view/right_border_tabs/connectome_tab/connectome_data_utils";

const NO_ACTIVE_AGGLOMERATE_IDS: Array<number> = [];
const NO_SYNAPSE_TYPES: Array<string> = [];

// Fetches the synapses of the active agglomerates from the current connectome file
// and holds the resulting connectome data as well as the checked/expanded state
// of the synapse tree.
export default function useConnectomeData(
  segmentationLayer: APISegmentationLayer | null | undefined,
) {
  const layerName = segmentationLayer?.name;
  const dataset = useWkSelector((state) => state.dataset);
  const currentConnectomeFile = useWkSelector((state) =>
    layerName != null ? getConnectomeDataForLayer(state, layerName).currentConnectomeFile : null,
  );
  const activeAgglomerateIds =
    useWkSelector((state) =>
      layerName != null ? getConnectomeDataForLayer(state, layerName).activeAgglomerateIds : null,
    ) ?? NO_ACTIVE_AGGLOMERATE_IDS;

  const enabled =
    segmentationLayer != null && currentConnectomeFile != null && activeAgglomerateIds.length > 0;

  const { data, isPlaceholderData, isError } = useQueryWithErrorHandling(
    {
      queryKey: [
        "synapsesOfAgglomerates",
        dataset.id,
        layerName,
        currentConnectomeFile?.connectomeFileName,
        activeAgglomerateIds,
      ],
      queryFn: () => {
        if (segmentationLayer == null || currentConnectomeFile == null) {
          // Guaranteed by the enabled flag, but TS cannot infer this in the closure
          throw new Error("Cannot fetch connectome data without a layer and connectome file.");
        }
        return fetchConnectomeData(
          dataset,
          segmentationLayer,
          currentConnectomeFile,
          activeAgglomerateIds,
        );
      },
      enabled,
      // Keep showing the previous synapses while a new selection is loading so that
      // the tree sync only needs to apply a minimal diff once the new data arrives.
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      // Don't persist the potentially large synapse data to localStorage
      meta: { persist: false },
    },
    "Failed to load the synapses of the selected segment(s).",
  );

  const [checkedKeys, setCheckedKeys] = useState<Array<string>>([]);
  const [expandedKeys, setExpandedKeys] = useState<Array<string>>([]);

  // Initialize the checked/expanded keys (auto-expand all nodes, auto-check the
  // active agglomerates) once the data for the current selection is available.
  // This adjusts state during render rather than in an effect,
  // see https://react.dev/learn/you-might-not-need-an-effect.
  const selectionKey = enabled
    ? `${layerName}/${currentConnectomeFile.connectomeFileName}/${activeAgglomerateIds.join(",")}`
    : null;
  const [initializedSelectionKey, setInitializedSelectionKey] = useState<string | null>(null);
  if (
    selectionKey != null &&
    data != null &&
    !isPlaceholderData &&
    initializedSelectionKey !== selectionKey
  ) {
    setInitializedSelectionKey(selectionKey);
    setCheckedKeys(data.initialCheckedKeys);
    setExpandedKeys(data.initialExpandedKeys);
  }

  const resetTreeData = useCallback(() => {
    setCheckedKeys([]);
    setExpandedKeys([]);
    setInitializedSelectionKey(null);
  }, []);

  // While a new selection is loading, data still holds the previous selection's
  // synapses (see placeholderData above). When no selection is active, derive null
  // so that the tree sync hooks remove the loaded trees.
  const connectomeData = enabled && data != null ? data.connectomeData : null;
  const availableSynapseTypes = data?.availableSynapseTypes ?? NO_SYNAPSE_TYPES;
  const isLoading = enabled && !isError && (data == null || isPlaceholderData);

  return {
    connectomeData,
    availableSynapseTypes,
    checkedKeys,
    expandedKeys,
    isLoading,
    setCheckedKeys,
    setExpandedKeys,
    resetTreeData,
    currentConnectomeFile,
    activeAgglomerateIds,
  };
}
