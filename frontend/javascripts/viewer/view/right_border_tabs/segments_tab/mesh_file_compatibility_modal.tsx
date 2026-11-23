import { Button, Modal, Select, Space, Typography } from "antd";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";
import { useState } from "react";
import type { APIDataset, APIMeshFileInfo } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import { getMappingInfo, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import {
  doesMeshFileMatchMapping,
  isMeshFileVersionSupported,
  sortMeshFilesByPreference,
} from "viewer/model/accessors/mesh_file_accessor";
import { hasEditableMapping } from "viewer/model/accessors/volumetracing_accessor";
import { updateCurrentMeshFileAction } from "viewer/model/actions/annotation_actions";
import Store from "viewer/store";

/*
 * Use this for actions that load precomputed meshes of a layer. Such meshes can only be loaded
 * from a mesh file that is compatible with the active mapping, i.e., one that was computed without
 * a mapping or for exactly that mapping. Without this check, users wouldn't know what to do if the
 * active mesh file isn't compatible or if no mesh file is active.
 *
 * The returned function checks the active mesh file of the layer when it is called:
 * - If it is compatible, loadMeshes is called with its name right away.
 * - Otherwise, a modal is shown. If compatible mesh files exist, the user can select one of them.
 *   It becomes the active mesh file and loadMeshes is called with its name. If none exists, the
 *   modal explains how to precompute one.
 * loadMeshes is not called if the user closes the modal.
 */
export function withMeshFileCompatibilityCheck(
  loadMeshes: (meshFileName: string) => void,
  layerName: string | null | undefined,
): () => void {
  return () => {
    if (layerName == null) {
      return;
    }
    const state = Store.getState();
    const { currentMeshFile, availableMeshFiles } = state.localSegmentationStateByLayer[layerName];
    if (currentMeshFile == null && availableMeshFiles == null) {
      Toast.info("The mesh files are still being loaded. Please try again in a moment.");
      return;
    }
    const mappingInfo = getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      layerName,
    );
    const activeMappingName =
      mappingInfo.mappingStatus === MappingStatusEnum.ENABLED
        ? (mappingInfo.mappingName ?? null)
        : null;

    // The version isn't checked here, so that mesh files of an older format are still loaded as before.
    if (currentMeshFile != null && doesMeshFileMatchMapping(currentMeshFile, activeMappingName)) {
      loadMeshes(currentMeshFile.name);
      return;
    }

    const isEditableMappingActive = hasEditableMapping(state, layerName);
    const compatibleMeshFiles = sortMeshFilesByPreference(
      (availableMeshFiles ?? []).filter(
        (meshFile) =>
          isMeshFileVersionSupported(meshFile) &&
          doesMeshFileMatchMapping(meshFile, activeMappingName),
      ),
      activeMappingName,
      isEditableMappingActive,
    );

    renderIndependently((destroy) => (
      <MeshFileCompatibilityModal
        layerName={layerName}
        meshFile={currentMeshFile ?? null}
        activeMappingName={activeMappingName}
        isEditableMappingActive={isEditableMappingActive}
        compatibleMeshFiles={compatibleMeshFiles}
        dataset={state.dataset}
        hasVolumeTracing={state.annotation.volumes.length > 0}
        loadMeshes={loadMeshes}
        destroy={destroy}
      />
    ));
  };
}

function MeshFileCompatibilityModal({
  layerName,
  meshFile,
  activeMappingName,
  isEditableMappingActive,
  compatibleMeshFiles,
  dataset,
  hasVolumeTracing,
  loadMeshes,
  destroy,
}: {
  layerName: string;
  meshFile: APIMeshFileInfo | null;
  activeMappingName: string | null;
  isEditableMappingActive: boolean;
  compatibleMeshFiles: APIMeshFileInfo[];
  dataset: APIDataset;
  hasVolumeTracing: boolean;
  loadMeshes: (meshFileName: string) => void;
  destroy: () => void;
}) {
  const [selectedMeshFileName, setSelectedMeshFileName] = useState(compatibleMeshFiles[0]?.name);

  const switchMeshFileAndLoad = () => {
    if (selectedMeshFileName == null) {
      return;
    }
    Store.dispatch(updateCurrentMeshFileAction(layerName, selectedMeshFileName));
    destroy();
    loadMeshes(selectedMeshFileName);
  };

  const activeMappingDescription = isEditableMappingActive
    ? "the mapping was edited by proofreading. An edited mapping can only be used with a mesh file that was computed without a mapping"
    : activeMappingName != null
      ? `the mapping "${activeMappingName}" is active`
      : "no mapping is active";

  const precomputeLocation = hasVolumeTracing ? (
    <>
      <a href={getViewDatasetURL(dataset)} target="_blank" rel="noopener noreferrer">
        open the dataset in view mode
      </a>
      , click the + button ("Add a precomputed mesh file") in the Segments tab
    </>
  ) : (
    'click the + button ("Add a precomputed mesh file") in the Segments tab'
  );

  // The mapping isn't offered to be changed: users choose it for what they want to see, and the
  // mesh file has to follow that choice.
  const footer =
    compatibleMeshFiles.length > 0
      ? [
          <Button key="cancel" onClick={destroy}>
            Cancel
          </Button>,
          <Button key="switchMeshFile" type="primary" onClick={switchMeshFileAndLoad}>
            {meshFile == null ? "Activate selected mesh file" : "Switch to selected mesh file"}
          </Button>,
        ]
      : [
          <Button key="close" type="primary" onClick={destroy}>
            Close
          </Button>,
        ];

  return (
    <Modal
      open
      title={
        meshFile == null ? "No mesh file is active" : "The mesh file doesn't match the mapping"
      }
      onCancel={destroy}
      footer={footer}
    >
      {meshFile != null ? (
        <Typography.Paragraph>
          {`The active mesh file "${meshFile.name}" was computed for the mapping "${meshFile.mappingName}", but ${activeMappingDescription}.`}
        </Typography.Paragraph>
      ) : null}

      {compatibleMeshFiles.length > 0 ? (
        <Typography.Paragraph>
          <Space orientation="vertical" style={{ width: "100%" }}>
            {meshFile == null
              ? "Select a mesh file to load the mesh:"
              : "Switch to a compatible mesh file to load the mesh:"}
            <Select
              style={{ width: "100%" }}
              value={selectedMeshFileName}
              onChange={setSelectedMeshFileName}
              options={compatibleMeshFiles.map((compatibleMeshFile) => ({
                value: compatibleMeshFile.name,
                label:
                  compatibleMeshFile.mappingName == null
                    ? `${compatibleMeshFile.name} (without mapping)`
                    : `${compatibleMeshFile.name} (${compatibleMeshFile.mappingName})`,
              }))}
            />
          </Space>
        </Typography.Paragraph>
      ) : (
        <Typography.Paragraph>
          There is no compatible mesh file. To create one, {precomputeLocation} and precompute the
          meshes with the mapping "None". Such a mesh file works with every mapping and for
          proofreading. Until it is computed, you can compute meshes ad-hoc instead.
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
