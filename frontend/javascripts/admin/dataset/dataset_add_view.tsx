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
import PostUploadModal from "./components/post_upload_modal";
import VoxelyticsBanner from "./components/voxelytics_banner";
import DatasetAddComposeView from "./dataset_add_compose_view";

const { Content } = Layout;

// Used for the tab keys as well as for
// distinguishing between the add type after
// successful import.
export enum DatasetAddType {
  UPLOAD = "upload",
  REMOTE = "remote",
  COMPOSE = "compose",
}

const ALIGNMENT_PROJECT_TAB_KEY = "alignmentProject";

function DatasetAddView() {
  const navigate = useNavigate();
  const location = useLocation();
  useBlockNavigationDuringUploads();
  const datastores = useFetch<APIDataStore[]>(getDatastores, [], []);
  const canUseAlignmentProjects = useWkSelector(
    (state) => features().jobsEnabled && isUserAdminOrDatasetManager(state.activeUser),
  );
  const [datasetId, setDatasetId] = useState("");
  const [uploadedDatasetName, setUploadedDatasetName] = useState("");
  const [datasetNeedsConversion, setDatasetNeedsConversion] = useState(false);
  const [datasetAddType, setImportType] = useState<DatasetAddType>(DatasetAddType.UPLOAD);

  const handleDatasetAdded = async (
    datasetAddType: DatasetAddType,
    datasetId: string,
    datasetName: string,
    needsConversion: boolean | null | undefined,
  ): Promise<void> => {
    setDatasetId(datasetId);
    setImportType(datasetAddType);
    setUploadedDatasetName(datasetName);
    if (needsConversion != null) setDatasetNeedsConversion(needsConversion);
  };

  const showAfterUploadContent = datasetId !== "";

  const getAfterUploadModalContent = () => {
    if (!showAfterUploadContent) {
      return null;
    }

    return (
      <PostUploadModal
        datasetNeedsConversion={datasetNeedsConversion}
        datasetAddType={datasetAddType}
        datasetId={datasetId}
        uploadedDatasetName={uploadedDatasetName}
        setDatasetId={setDatasetId}
        navigate={navigate}
      />
    );
  };

  const tabs: TabsProps["items"] = [
    {
      label: "Upload Dataset",
      icon: <UploadOutlined />,
      key: DatasetAddType.UPLOAD,
      children: (
        <DatasetUploadView
          datastores={datastores}
          onUploaded={handleDatasetAdded.bind(null, DatasetAddType.UPLOAD)}
        />
      ),
    },
    {
      icon: <DatabaseOutlined />,
      label: "Add Remote Dataset",
      key: DatasetAddType.REMOTE,
      children: (
        <DatasetAddRemoteView
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
      {getAfterUploadModalContent()}
    </React.Fragment>
  );
}
export default DatasetAddView;
