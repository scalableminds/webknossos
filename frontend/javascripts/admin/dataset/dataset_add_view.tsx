import {
  AppstoreOutlined,
  CopyOutlined,
  DatabaseOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import AlignmentProjectUploadView from "admin/alignment_project/alignment_project_upload_view";

import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import { useBlockNavigationDuringUploads } from "admin/dataset/upload/use_resumable_upload";
import { getDatastores } from "admin/rest_api";
import { Flex, Layout, Tabs, type TabsProps } from "antd";
import features from "features";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrDatasetManager } from "libs/utils";

import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { APIDataStore } from "types/api_types";
import VoxelyticsBanner from "./components/voxelytics_banner";
import DatasetAddComposeView from "./dataset_add_compose_view";
import { DatasetAddType } from "./dataset_add_type";
import { getAddedDatasetStatus, UploadProgressModal } from "./upload/upload_progress_modal";
import type { UploadStatus } from "./upload/use_resumable_dataset_upload";

const { Content } = Layout;

// Not part of DatasetAddType, because this tab creates an alignment project, not a dataset.
const ALIGNMENT_PROJECT_TAB_KEY = "alignmentProject";

function DatasetAddView() {
  const navigate = useNavigate();
  const location = useLocation();
  useBlockNavigationDuringUploads();
  const datastores = useFetch<APIDataStore[]>(getDatastores, [], []);
  const canUseAlignmentProjects = useWkSelector(
    (state) => features().jobsEnabled && isUserAdminOrDatasetManager(state.activeUser),
  );
  // Uploads show their own modal, so this is only used for remote and composed datasets.
  const [addedDatasetStatus, setAddedDatasetStatus] = useState<UploadStatus>({ kind: "idle" });
  const [datasetAddType, setDatasetAddType] = useState<DatasetAddType>(DatasetAddType.REMOTE);
  // Remounting a view resets its form, so that the next dataset can be added from scratch.
  const [viewKeys, setViewKeys] = useState({
    [DatasetAddType.REMOTE]: 0,
    [DatasetAddType.COMPOSE]: 0,
  });

  const handleDatasetAdded = async (
    datasetAddType: DatasetAddType,
    datasetId: string,
    datasetName: string,
  ): Promise<void> => {
    setDatasetAddType(datasetAddType);
    setAddedDatasetStatus(getAddedDatasetStatus(datasetId, datasetName));
  };

  const handleAddedDatasetModalClose = () => {
    setAddedDatasetStatus({ kind: "idle" });
    if (datasetAddType === DatasetAddType.UPLOAD) return;
    setViewKeys((keys) => ({ ...keys, [datasetAddType]: keys[datasetAddType] + 1 }));
  };

  const tabs: TabsProps["items"] = [
    {
      label: "Upload Dataset",
      icon: <UploadOutlined />,
      key: DatasetAddType.UPLOAD,
      children: <DatasetUploadView datastores={datastores} />,
    },
    {
      icon: <DatabaseOutlined />,
      label: "Add Remote Dataset",
      key: DatasetAddType.REMOTE,
      children: (
        <DatasetAddRemoteView
          key={viewKeys[DatasetAddType.REMOTE]}
          datastores={datastores}
          onAdded={handleDatasetAdded.bind(null, DatasetAddType.REMOTE)}
        />
      ),
    },
    {
      icon: <CopyOutlined />,
      label: "Compose From Existing Datasets",
      key: DatasetAddType.COMPOSE,
      children: (
        <DatasetAddComposeView
          key={viewKeys[DatasetAddType.COMPOSE]}
          datastores={datastores}
          onAdded={handleDatasetAdded.bind(null, DatasetAddType.COMPOSE)}
        />
      ),
    },
    ...(canUseAlignmentProjects
      ? [
          {
            icon: <AppstoreOutlined />,
            label: "Upload Files for Alignment Project",
            key: ALIGNMENT_PROJECT_TAB_KEY,
            children: <AlignmentProjectUploadView datastores={datastores} />,
          },
        ]
      : []),
  ];

  const activeTabFromHash = location.hash.substring(1);
  const activeKey = tabs.some((tab) => tab.key === activeTabFromHash)
    ? activeTabFromHash
    : DatasetAddType.UPLOAD;

  return (
    <React.Fragment>
      <Layout style={{ minHeight: "100vh", backgroundColor: "var(--ant-layout-body-bg)" }}>
        <Content>
          <Tabs
            activeKey={activeKey}
            // Keep the search params, e.g. the target folder.
            onChange={(key) => navigate({ search: location.search, hash: key }, { replace: true })}
            className="container"
            // Show the banner within each tab's content, so that it lines up with the tab's card.
            items={tabs.map((tab) => ({
              ...tab,
              children: (
                <Flex gap="large" align="flex-start">
                  <div style={{ flex: 1, minWidth: 0 }}>{tab.children}</div>
                  <VoxelyticsBanner />
                </Flex>
              ),
            }))}
          />
        </Content>
      </Layout>
      <UploadProgressModal
        status={addedDatasetStatus}
        datasetAddType={datasetAddType}
        onClose={handleAddedDatasetModalClose}
      />
    </React.Fragment>
  );
}
export default DatasetAddView;
