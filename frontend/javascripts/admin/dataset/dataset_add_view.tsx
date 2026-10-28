import { CopyOutlined, DatabaseOutlined, UploadOutlined } from "@ant-design/icons";

import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import { getDatastores } from "admin/rest_api";
import { Flex, Layout, Tabs, type TabsProps } from "antd";
import { useFetch } from "libs/react_helpers";

import React, { useState } from "react";
import type { APIDataStore } from "types/api_types";
import VoxelyticsBanner from "./components/voxelytics_banner";
import DatasetAddComposeView from "./dataset_add_compose_view";
import { DatasetAddType } from "./dataset_add_type";
import { getAddedDatasetStatus, UploadProgressModal } from "./upload/upload_progress_modal";
import type { UploadStatus } from "./upload/use_resumable_dataset_upload";

const { Content } = Layout;

function DatasetAddView() {
  const datastores = useFetch<APIDataStore[]>(getDatastores, [], []);
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

  const defaultActiveTabFromHash = location.hash.substring(1);
  const defaultActiveKey = Object.values(DatasetAddType).includes(
    defaultActiveTabFromHash as DatasetAddType,
  )
    ? (defaultActiveTabFromHash as DatasetAddType)
    : DatasetAddType.UPLOAD;

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
  ];

  return (
    <React.Fragment>
      <Layout style={{ minHeight: "100vh", backgroundColor: "var(--ant-layout-body-bg)" }}>
        <Content>
          <Tabs
            defaultActiveKey={defaultActiveKey}
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
