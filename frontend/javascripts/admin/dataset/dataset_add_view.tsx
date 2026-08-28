import { CopyOutlined, DatabaseOutlined, UploadOutlined } from "@ant-design/icons";

import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import { getDatastores } from "admin/rest_api";
import { Layout, Tabs, type TabsProps } from "antd";
import { useFetch } from "libs/react_helpers";

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
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

function DatasetAddView() {
  const navigate = useNavigate();
  const datastores = useFetch<APIDataStore[]>(getDatastores, [], []);
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
  ];

  return (
    <React.Fragment>
      <Layout style={{ minHeight: "100vh", backgroundColor: "var(--ant-layout-body-bg)" }}>
        <Content>
          <Tabs defaultActiveKey={defaultActiveKey} className="container" items={tabs} />
        </Content>
        <VoxelyticsBanner />
      </Layout>
      {getAfterUploadModalContent()}
    </React.Fragment>
  );
}
export default DatasetAddView;
