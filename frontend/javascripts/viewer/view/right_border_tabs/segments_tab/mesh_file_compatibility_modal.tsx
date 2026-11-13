import { Button, Modal, Select, Space, Typography } from "antd";
import renderIndependently from "libs/render_independently";
import { useState } from "react";
import type { APIDataset, APIMeshFileInfo } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import { getMappingInfo, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { hasEditableMapping } from "viewer/model/accessors/volumetracing_accessor";
import { updateCurrentMeshFileAction } from "viewer/model/actions/annotation_actions";
import Store from "viewer/store";

// Mesh files with an older format don't store their mapping and are not supported anymore.
const MIN_SUPPORTED_MESH_FILE_VERSION = 3;

function isMeshFileVersionSupported(meshFile: APIMeshFileInfo) {
  return meshFile.formatVersion >= MIN_SUPPORTED_MESH_FILE_VERSION;
}

function doesMeshFileMatchMapping(meshFile: APIMeshFileInfo, activeMappingName: string | null) {
  // A mesh file computed without a mapping can be used with every mapping, including an editable one.
  return meshFile.mappingName == null || meshFile.mappingName === activeMappingName;
}

/*
 * Wraps a callback that loads meshes from the given mesh file. The callback is called with the
 * current mesh file. If that mesh file was computed for another mapping than the active one, a
 * modal offers to switch to a compatible mesh file instead (with which the callback is called then).
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
    if (currentMeshFile == null) {
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
    if (doesMeshFileMatchMapping(currentMeshFile, activeMappingName)) {
      loadMeshes(currentMeshFile.name);
      return;
    }

    const isEditableMappingActive = hasEditableMapping(state, layerName);
    const compatibleMeshFiles = (availableMeshFiles ?? [])
      .filter(
        (meshFile) =>
          isMeshFileVersionSupported(meshFile) &&
          doesMeshFileMatchMapping(meshFile, activeMappingName),
      )
      // Prefer mesh files computed for the active mapping, since they load agglomerates faster.
      .sort((a, b) => Number(b.mappingName != null) - Number(a.mappingName != null));

    renderIndependently((destroy) => (
      <MeshFileCompatibilityModal
        layerName={layerName}
        meshFile={currentMeshFile}
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
  meshFile: APIMeshFileInfo;
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
            Switch to selected mesh file
          </Button>,
        ]
      : [
          <Button key="close" type="primary" onClick={destroy}>
            Close
          </Button>,
        ];

  return (
    <Modal open title="The mesh file doesn't match the mapping" onCancel={destroy} footer={footer}>
      <Typography.Paragraph>
        {`The active mesh file "${meshFile.name}" was computed for the mapping "${meshFile.mappingName}", but ${activeMappingDescription}.`}
      </Typography.Paragraph>

      {compatibleMeshFiles.length > 0 ? (
        <Typography.Paragraph>
          <Space orientation="vertical" style={{ width: "100%" }}>
            Switch to a compatible mesh file to load the mesh:
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
