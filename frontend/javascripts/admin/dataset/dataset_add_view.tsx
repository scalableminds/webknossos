import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import { Tabs, Modal, Button, Layout } from "antd";
import { DatabaseOutlined, GoogleOutlined, UploadOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { connect } from "react-redux";
import type { APIDataStore } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import DatasetAddNeuroglancerView from "admin/dataset/dataset_add_neuroglancer_view";
import DatasetAddBossView from "admin/dataset/dataset_add_boss_view";
import DatasetAddZarrView from "admin/dataset/dataset_add_zarr_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import features from "features";
import { getDatastores } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";

const { TabPane } = Tabs;
const { Content, Sider } = Layout;

const fetchCategorizedDatastores = async (): Promise<{
  own: Array<APIDataStore>;
  wkConnect: Array<APIDataStore>;
}> => {
  const fetchedDatastores = await getDatastores();
  return {
    own: fetchedDatastores.filter((ds) => !ds.isConnector),
    wkConnect: fetchedDatastores.filter((ds) => ds.isConnector),
  };
};

enum DatasetAddViewTabs {
  UPLOAD = "upload",
  REMOTE = "remote",
  NEUROGLANCER = "neuroglancer",
  BOSSDB = "bossdb",
}

function DatasetAddView({ history }: RouteComponentProps) {
  const datastores = useFetch(
    fetchCategorizedDatastores,
    {
      own: [],
      wkConnect: [],
    },
    [],
  );
  const [datasetName, setDatasetName] = useState("");
  const [organization, setOrganization] = useState("");
  const [datasetNeedsConversion, setDatasetNeedsConversion] = useState(false);
  const [isRemoteDataset, setIsRemoteDataset] = useState(false);

  const handleDatasetAdded = async (
    datasetOrganization: string,
    uploadedDatasetName: string,
    isRemoteDataset: boolean,
    needsConversion: boolean | null | undefined,
  ): Promise<void> => {
    setOrganization(datasetOrganization);
    setDatasetName(uploadedDatasetName);
    setIsRemoteDataset(isRemoteDataset);
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
        The dataset was {isRemoteDataset ? "imported" : "uploaded"} successfully
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
  const defaultActiveKey = Object.values(DatasetAddViewTabs).includes(
    defaultActiveTabFromHash as DatasetAddViewTabs,
  )
    ? (defaultActiveTabFromHash as DatasetAddViewTabs)
    : DatasetAddViewTabs.UPLOAD;

  return (
    <React.Fragment>
      <Layout>
        <Content>
          <Tabs defaultActiveKey={defaultActiveKey} className="container">
            <TabPane
              tab={
                <span>
                  <UploadOutlined />
                  Upload Dataset
                </span>
              }
              key={DatasetAddViewTabs.UPLOAD}
            >
              <DatasetUploadView datastores={datastores.own} onUploaded={handleDatasetAdded} />
            </TabPane>
            <TabPane
              tab={
                <span>
                  <DatabaseOutlined />
                  Add Remote Dataset
                </span>
              }
              key={DatasetAddViewTabs.REMOTE}
            >
              <DatasetAddZarrView
                datastores={datastores.own}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(datasetOrganization: string, uploadedDatase... Remove this comment to see the full error message
                onAdded={handleDatasetAdded}
              />
            </TabPane>
            {datastores.wkConnect.length > 0 && (
              <TabPane
                tab={
                  <span>
                    <GoogleOutlined />
                    Add Remote Neuroglancer Dataset
                  </span>
                }
                key={DatasetAddViewTabs.NEUROGLANCER}
              >
                <DatasetAddNeuroglancerView
                  datastores={datastores.wkConnect}
                  // @ts-expect-error ts-migrate(2322) FIXME: Type '(datasetOrganization: string, uploadedDatase... Remove this comment to see the full error message
                  onAdded={handleDatasetAdded}
                />
              </TabPane>
            )}
            {datastores.wkConnect.length > 0 && (
              <TabPane
                tab={
                  <span>
                    <DatabaseOutlined />
                    Add Remote BossDB Dataset
                  </span>
                }
                key={DatasetAddViewTabs.BOSSDB}
              >
                <DatasetAddBossView
                  datastores={datastores.wkConnect}
                  // @ts-expect-error ts-migrate(2322) FIXME: Type '(datasetOrganization: string, uploadedDatase... Remove this comment to see the full error message
                  onAdded={handleDatasetAdded}
                />
              </TabPane>
            )}
          </Tabs>
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

  if (!features().isWkorgInstance) {
    return null;
  }

  return (
    <Sider className="hide-on-small-screen" width={300}>
      {banners[bannerIndex]}
    </Sider>
  );
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

const connector = connect(mapStateToProps);
export default connector(withRouter(DatasetAddView));
