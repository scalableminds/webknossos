import { Table } from "antd";
import _ from "lodash";
import type React from "react";

import type { ColumnsType } from "antd/lib/table";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { localeCompareBy } from "libs/utils";
import type {
  VoxelyticsArtifactConfig,
  VoxelyticsTaskConfigWithHierarchy,
} from "types/api_flow_types";
import { renderArtifactPath } from "./artifacts_view";

type ArtifactTableEntry = {
  artifactName: string;
  taskName: string;
  fileSize: number;
  inodes: string;
  inodeCount: number;
  filePath: string;
  filePathComponent: React.ReactNode;
};

export default function DiskUsageList({
  tasksWithHierarchy,
  artifacts,
}: {
  tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy>;
  artifacts: Record<string, Record<string, VoxelyticsArtifactConfig>>;
}) {
  function taskToTableEntry(
    taskGroup: VoxelyticsTaskConfigWithHierarchy,
  ): Array<ArtifactTableEntry> {
    if (taskGroup.isMetaTask) {
      return _.flatten(
        taskGroup.subtasks
          .map(taskToTableEntry)
          .filter((artifactTableEntry) => artifactTableEntry != null),
      );
    }
    if (!artifacts[taskGroup.taskName]) {
      return [];
    }
    return Object.entries(artifacts[taskGroup.taskName]).map(([artifactName, artifact]) => ({
      artifactName,
      fileSize: artifact.fileSize,
      taskName: taskGroup.taskName,
      inodes: artifact.inodeCount.toLocaleString(),
      inodeCount: artifact.inodeCount,
      filePathComponent: renderArtifactPath(artifact),
      filePath: artifact.path,
    }));
  }

  const dataSource = _.flatten(tasksWithHierarchy.map(taskToTableEntry));

  const columns: ColumnsType<ArtifactTableEntry> = [
    {
      title: "Task Name",
      dataIndex: "taskName",
      key: "taskName",
      sorter: localeCompareBy((artifact: ArtifactTableEntry) => artifact.taskName),
    },
    {
      title: "Artifact Name",
      dataIndex: "artifactName",
      key: "artifactName",
      sorter: localeCompareBy((artifact: ArtifactTableEntry) => artifact.artifactName),
    },
    {
      title: "File Size",
      dataIndex: "fileSize",
      key: "fileSize",
      render: (fileSize, _record) => formatCountToDataAmountUnit(fileSize),
      sorter: (a, b) => a.fileSize - b.fileSize,
      defaultSortOrder: "descend",
    },
    {
      title: "Inode Count",
      dataIndex: "inodes",
      key: "inodes",
      sorter: (a, b) => a.inodeCount - b.inodeCount,
    },
    {
      title: "Artifact Path",
      dataIndex: "filePathComponent",
      key: "filePath",
      sorter: localeCompareBy((artifact: ArtifactTableEntry) => artifact.filePath),
    },
  ];
  return <Table dataSource={dataSource} columns={columns} />;
}
