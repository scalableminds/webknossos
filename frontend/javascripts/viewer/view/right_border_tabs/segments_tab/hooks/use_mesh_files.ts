import { useWkSelector } from "libs/react_hooks";
import { useCallback, useEffect } from "react";
import { useDispatch } from "react-redux";
import type { APIMeshFileInfo } from "types/api_types";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  maybeFetchMeshFilesAction,
  updateCurrentMeshFileAction,
} from "viewer/model/actions/annotation_actions";

export type MeshFiles = {
  availableMeshFiles: APIMeshFileInfo[] | null | undefined;
  currentMeshFile: APIMeshFileInfo | null | undefined;
  setCurrentMeshFile: (meshFileName: string) => void;
  refreshMeshFiles: () => void;
};

/*
 * Provides the precomputed mesh files of the visible segmentation layer.
 * The files are (re-)fetched whenever the visible layer changes.
 */
export function useMeshFiles(): MeshFiles {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);

  const availableMeshFiles = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationStateByLayer[visibleSegmentationLayer.name].availableMeshFiles
      : null,
  );
  const currentMeshFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationStateByLayer[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );

  useEffect(() => {
    dispatch(maybeFetchMeshFilesAction(visibleSegmentationLayer, dataset, false));
  }, [dispatch, visibleSegmentationLayer, dataset]);

  const refreshMeshFiles = useCallback(() => {
    dispatch(maybeFetchMeshFilesAction(visibleSegmentationLayer, dataset, true));
  }, [dispatch, visibleSegmentationLayer, dataset]);

  const setCurrentMeshFile = useCallback(
    (meshFileName: string) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      dispatch(updateCurrentMeshFileAction(visibleSegmentationLayer.name, meshFileName));
    },
    [dispatch, visibleSegmentationLayer],
  );

  return { availableMeshFiles, currentMeshFile, setCurrentMeshFile, refreshMeshFiles };
}
