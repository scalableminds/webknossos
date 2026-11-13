import { Button, Modal, Select, Space, Typography } from "antd";
import renderIndependently from "libs/render_independently";
import { useRef, useState } from "react";
import type { APIDataset, APIMeshFileInfo } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import { getMappingInfo, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import {
  hasEditableMapping,
  isMappingActivationAllowed,
} from "viewer/model/accessors/volumetracing_accessor";
import { updateCurrentMeshFileAction } from "viewer/model/actions/annotation_actions";
import Store from "viewer/store";
import { activateAgglomerateMappingAndWait } from "./segments_view_helper";

// Mesh files with an older format don't store their mapping and are not supported anymore.
const MIN_SUPPORTED_MESH_FILE_VERSION = 3;

function isMeshFileCompatible(meshFile: APIMeshFileInfo, activeMappingName: string | null) {
  // A mesh file computed without a mapping can be used with every mapping, including an editable one.
  return meshFile.mappingName == null || meshFile.mappingName === activeMappingName;
}

/*
 * Wraps a callback that loads meshes from the current mesh file. If that mesh file was computed
 * for another mapping than the active one, a modal offers ways to resolve that instead.
 * The callback has to read the current mesh file when it is called, because the modal can switch it.
 */
export function withMeshFileCompatibilityCheck(
  loadMeshes: () => void,
  layerName: string | null | undefined,
): () => void {
  return () => {
    if (layerName == null) {
      loadMeshes();
      return;
    }
    const state = Store.getState();
    const { currentMeshFile, availableMeshFiles } = state.localSegmentationStateByLayer[layerName];
    const mappingInfo = getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      layerName,
    );
    const activeMappingName =
      mappingInfo.mappingStatus === MappingStatusEnum.ENABLED
        ? (mappingInfo.mappingName ?? null)
        : null;

    if (currentMeshFile == null || isMeshFileCompatible(currentMeshFile, activeMappingName)) {
      loadMeshes();
      return;
    }

    const isEditableMappingActive = hasEditableMapping(state, layerName);
    const compatibleMeshFiles = (availableMeshFiles ?? [])
      .filter(
        (meshFile) =>
          meshFile.formatVersion >= MIN_SUPPORTED_MESH_FILE_VERSION &&
          isMeshFileCompatible(meshFile, activeMappingName),
      )
      // Prefer mesh files computed for the active mapping, since they load agglomerates faster.
      .sort((a, b) => Number(b.mappingName != null) - Number(a.mappingName != null));

    renderIndependently((destroy) => (
      <MeshFileCompatibilityModal
        layerName={layerName}
        meshFile={currentMeshFile}
        activeMappingName={activeMappingName}
        isEditableMappingActive={isEditableMappingActive}
        canActivateMeshFileMapping={isMappingActivationAllowed(
          state,
          currentMeshFile.mappingName,
          layerName,
        )}
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
  canActivateMeshFileMapping,
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
  canActivateMeshFileMapping: boolean;
  compatibleMeshFiles: APIMeshFileInfo[];
  dataset: APIDataset;
  hasVolumeTracing: boolean;
  loadMeshes: () => void;
  destroy: () => void;
}) {
  const [selectedMeshFileName, setSelectedMeshFileName] = useState(compatibleMeshFiles[0]?.name);
  const [isActivatingMapping, setIsActivatingMapping] = useState(false);
  // The mapping activation can finish after the modal was dismissed. The meshes shouldn't be
  // loaded then.
  const wasDismissedRef = useRef(false);

  const dismiss = () => {
    wasDismissedRef.current = true;
    destroy();
  };

  const switchMeshFileAndLoad = () => {
    Store.dispatch(updateCurrentMeshFileAction(layerName, selectedMeshFileName));
    destroy();
    loadMeshes();
  };

  const activateMappingAndLoad = async () => {
    if (meshFile.mappingName == null) {
      return;
    }
    setIsActivatingMapping(true);
    const wasActivated = await activateAgglomerateMappingAndWait(layerName, meshFile.mappingName);
    if (wasDismissedRef.current) {
      return;
    }
    if (!wasActivated) {
      // The mapping saga already shows an error. Keep the modal open so that the user can retry.
      setIsActivatingMapping(false);
      return;
    }
    destroy();
    loadMeshes();
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

  const footer = [
    <Button key="cancel" onClick={dismiss}>
      Cancel
    </Button>,
    canActivateMeshFileMapping ? (
      <Button
        key="activateMapping"
        type={compatibleMeshFiles.length === 0 ? "primary" : "default"}
        loading={isActivatingMapping}
        onClick={activateMappingAndLoad}
      >
        Activate mapping "{meshFile.mappingName}"
      </Button>
    ) : null,
    compatibleMeshFiles.length > 0 ? (
      <Button key="switchMeshFile" type="primary" onClick={switchMeshFileAndLoad}>
        Use this mesh file
      </Button>
    ) : null,
  ];

  return (
    <Modal open title="The mesh file doesn't match the mapping" onCancel={dismiss} footer={footer}>
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
