import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import { Tabs, Modal, Button, Layout, TabsProps } from "antd";
import { CopyOutlined, DatabaseOutlined, UploadOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { connect, useSelector } from "react-redux";
import type { APIDataStore } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import features from "features";
import { getDatastores } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import DatasetAddComposeView from "./dataset_add_compose_view";

const { Content, Sider } = Layout;

// Used for the tab keys as well as for
// distinguishing between the add type after
// successful import.
enum DatasetAddType {
  UPLOAD = "upload",
  REMOTE = "remote",
  COMPOSE = "compose",
}
const addTypeToVerb: Record<DatasetAddType, string> = {
  upload: "uploaded",
  remote: "added",
  compose: "created",
};

function DatasetAddView({ history }: RouteComponentProps) {
  const datastores = useFetch<APIDataStore[]>(getDatastores, [], []);
  const [datasetName, setDatasetName] = useState("");
  const [organization, setOrganization] = useState("");
  const [datasetNeedsConversion, setDatasetNeedsConversion] = useState(false);
  const [datasetAddType, setImportType] = useState<DatasetAddType>(DatasetAddType.UPLOAD);

  const handleDatasetAdded = async (
    datasetAddType: DatasetAddType,
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion: boolean | null | undefined,
  ): Promise<void> => {
    setOrganization(datasetOrganization);
    setDatasetName(uploadedDatasetName);
    setImportType(datasetAddType);
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'boolean | null | undefined' is n... Remove this comment to see the full error message
    setDatasetNeedsConversion(needsConversion);
  };

  const showAfterUploadContent = datasetName !== "";

  const getAfterUploadModalContent = () => {
    if (!showAfterUploadContent) {
      return null;
    }

    return (
      <div
        style={{
          fontSize: 20,
          paddingTop: 13,
          textAlign: "center",
        }}
      >
        The dataset was {addTypeToVerb[datasetAddType]} successfully
        {datasetNeedsConversion ? " and a conversion job was started." : null}.
        <br />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            className="centered-items"
            style={{
              marginTop: 10,
            }}
          >
            {datasetNeedsConversion ? (
              <React.Fragment>
                <Button type="primary" onClick={() => history.push("/jobs")}>
                  View the Jobs Queue
                </Button>
                <Button onClick={() => history.push("/dashboard/datasets")}>Go to Dashboard</Button>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <Button
                  type="primary"
                  onClick={() => history.push(`/datasets/${organization}/${datasetName}/view`)}
                >
                  View the Dataset
                </Button>
                <Button
                  onClick={() => history.push(`/datasets/${organization}/${datasetName}/import`)}
                >
                  Go to Dataset Settings
                </Button>
                <Button onClick={() => history.push("/dashboard/datasets")}>Go to Dashboard</Button>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>
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
      <Layout>
        <Content>
          <Tabs defaultActiveKey={defaultActiveKey} className="container" items={tabs} />
        </Content>
        <VoxelyticsBanner />
      </Layout>
      <Modal
        open={showAfterUploadContent}
        closable={showAfterUploadContent}
        keyboard={showAfterUploadContent}
        maskClosable={false}
        className="no-footer-modal"
        cancelButtonProps={{
          style: {
            display: "none",
          },
        }}
        okButtonProps={{
          style: {
            display: "none",
          },
        }}
        onCancel={() => setDatasetName("")}
        onOk={() => setDatasetName("")}
        width={580}
      >
        {showAfterUploadContent && getAfterUploadModalContent()}
      </Modal>
    </React.Fragment>
  );
}

const segmentationBanner = (
  <div
    className="crosslink-box"
    style={{
      background: "url(/assets/images/vx/segmentation-l4dense_motta_et_al_demo_rotated.jpg)",
      height: 500,
      backgroundSize: "110%",
      padding: 0,
      backgroundPosition: "center",
    }}
  >
    <div
      style={{
        padding: "180px 10px 213px",
        background:
          "linear-gradient(181deg, transparent, rgb(59 59 59 / 20%), rgba(20, 19, 31, 0.84), #48484833, transparent)",
      }}
    >
      <h4
        style={{
          color: "white",
          textAlign: "center",
        }}
      >
        Are you looking for an automated segmentation of this dataset?
      </h4>
      <Button
        href="https://webknossos.org/services/automated-segmentation"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          margin: "10px auto",
          width: "50%",
        }}
      >
        Learn More
      </Button>
    </div>
  </div>
);
const alignBanner = (
  <div className="crosslink-box">
    <h4
      style={{
        fontWeight: "bold",
        textAlign: "center",
      }}
    >
      Are you looking for dataset alignment or stitching?
    </h4>
    <img
      src="/assets/images/vx/alignment-schema.png"
      alt="Schematic Alignment"
      style={{
        width: "100%",
      }}
    />
    <Button
      href="https://webknossos.org/services/alignment"
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        margin: "10px auto",
        width: "50%",
      }}
    >
      Learn More
    </Button>
  </div>
);
const manualAnnotationBanner = (
  <div
    className="crosslink-box"
    style={{
      background: "url(/assets/images/vx/manual-annotations-vertical.png)",
      height: 500,
      backgroundSize: "110%",
      padding: 0,
      backgroundPosition: "center",
    }}
  >
    <div
      style={{
        padding: "330px 10px 10px",
        background:
          "linear-gradient(181deg , transparent, rgba(59, 59, 59, 0.2), rgba(20, 19, 31, 0.84))",
      }}
    >
      <h4
        style={{
          color: "white",
          textAlign: "center",
        }}
      >
        Need more workforce for annotating your dataset?
        <br />
        Have a look at our annotation services.
      </h4>
      <Button
        href="https://webknossos.org/services/annotations"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          margin: "10px auto",
          width: "50%",
        }}
      >
        Learn More
      </Button>
    </div>
  </div>
);
const banners = [segmentationBanner, alignBanner, manualAnnotationBanner];

function VoxelyticsBanner() {
  const [bannerIndex] = useState(Math.floor(Math.random() * banners.length));
  const theme = useSelector((state: OxalisState) => state.uiInformation.theme);

  if (!features().isWkorgInstance) {
    return null;
  }

  return (
    <Sider className="hide-on-small-screen" width={300} theme={theme}>
      {banners[bannerIndex]}
    </Sider>
  );
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

const connector = connect(mapStateToProps);
export default connector(withRouter(DatasetAddView));
