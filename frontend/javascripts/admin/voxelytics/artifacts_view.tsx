import React from "react";
import { JSONTree } from "react-json-tree";
import { Button, Card, message } from "antd";
import { CopyOutlined } from "@ant-design/icons";

import { VoxelyticsArtifactConfig } from "types/api_flow_types";
import { getVoxelyticsArtifactChecksums } from "admin/admin_rest_api";
import { formatBytes } from "libs/format_utils";
import { theme } from "./task_view";

function isObjectEmpty(obj: Record<string, any>) {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
}

function ArtifactsView({
  artifacts,
  runId,
  workflowHash,
  taskName,
}: {
  artifacts: Record<string, VoxelyticsArtifactConfig>;
  runId: string;
  workflowHash: string;
  taskName: string;
}) {
  async function copyToClipboad(text: string) {
    await navigator.clipboard.writeText(text);
    message.success("Copied to clipboard");
  }

  async function downloadChecksumsCSV(artifactName: string) {
    const a = document.createElement("a");
    try {
      const checksums = await getVoxelyticsArtifactChecksums(
        workflowHash,
        runId,
        taskName,
        artifactName,
      );
      if (checksums.length === 0) {
        message.warning(`No checksums found for artifact '${artifactName}'.`);
      }

      const keys = Object.keys(checksums[0]);
      const csv = [
        keys.join(","),
        ...checksums.map((row) => keys.map((key) => row[key]).join(",")),
      ].join("\n");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `${workflowHash}_${taskName}_${artifactName}_checksums.csv`;
      a.click();
    } catch (error) {
      message.error("Could not download artifact checksums.");
    }
  }

  function renderArtifactPath(artifact: VoxelyticsArtifactConfig) {
    return (
      <div
        style={{
          backgroundColor: "#eee",
          fontFamily: "monospace",
          border: "1px solid #aaa",
          padding: 10,
          position: "relative",
          wordBreak: "break-word",
        }}
      >
        {artifact.path}
        <CopyOutlined
          style={{ top: 10, right: 10, position: "absolute" }}
          onClick={() => {
            copyToClipboad(artifact.path);
          }}
        />
      </div>
    );
  }

  function renderIframes(iframes: VoxelyticsArtifactConfig["metadata"]["iframes"]) {
    return (
      !isObjectEmpty(iframes) &&
      Object.entries(iframes).map(([iframeKey, iframeUrl]) => {
        const isImage = iframeUrl.match(/\.(jpg|png|gif)$/);
        return isImage ? (
          <img src={iframeUrl} style={{ maxWidth: "100%" }} alt={iframeKey} key={iframeKey} />
        ) : (
          <iframe
            key={iframeKey}
            title={iframeKey}
            src={iframeUrl}
            style={{
              width: "100%",
              marginBottom: 10,
              minHeight: 550,
              border: 0,
            }}
          />
        );
      })
    );
  }

  function renderLinks(links: VoxelyticsArtifactConfig["metadata"]["links"]) {
    return (
      !isObjectEmpty(links) && (
        <ul>
          {Object.entries(links).map(([linkKey, linkUrl]) => (
            <li key={linkKey}>
              <a href={linkUrl} target="_blank" rel="noreferrer">
                {linkKey}
              </a>
            </li>
          ))}
        </ul>
      )
    );
  }

  function renderAttributes(attributes: VoxelyticsArtifactConfig["metadata"]["attributes"]) {
    return !isObjectEmpty(attributes) && <JSONTree data={attributes} hideRoot theme={theme} />;
  }

  function renderArtifact(artifactName: string, artifact: VoxelyticsArtifactConfig) {
    const title = (
      <>
        <span>{artifactName}</span>
        <span style={{ fontSize: "10px", marginLeft: 10 }}>
          \\ version {artifact.version}, {formatBytes(artifact.fileSize)},{" "}
          {artifact.inodeCount.toLocaleString()} inodes
        </span>
      </>
    );

    return (
      <Card
        title={title}
        key={artifactName}
        extra={
          <Button
            onClick={(ev) => {
              ev.preventDefault();
              downloadChecksumsCSV(artifactName);
            }}
          >
            Download checksums
          </Button>
        }
        style={{ marginBottom: 10 }}
      >
        {renderLinks(artifact.metadata.links)}
        {renderAttributes(artifact.metadata.attributes)}
        {renderIframes(artifact.metadata.iframes)}
        {renderArtifactPath(artifact)}
      </Card>
    );
  }

  return (
    <>
      {Object.entries(artifacts).map(([artifactName, artifact]) =>
        renderArtifact(artifactName, artifact),
      )}
    </>
  );
}

export default ArtifactsView;
