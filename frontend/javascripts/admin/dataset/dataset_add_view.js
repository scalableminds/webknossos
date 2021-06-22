// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Modal, Button, Layout } from "antd";
import { BarsOutlined, DatabaseOutlined, GoogleOutlined, UploadOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { connect } from "react-redux";
import _ from "lodash";

import type { APIUser, APIDataStore } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import DatasetAddNeuroglancerView from "admin/dataset/dataset_add_neuroglancer_view";
import DatasetAddBossView from "admin/dataset/dataset_add_boss_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import LinkButton from "components/link_button";
import features from "features";
import { getDatastores } from "admin/admin_rest_api";
import renderIndependently from "libs/render_independently";
import { useFetch } from "libs/react_helpers";

const { TabPane } = Tabs;
const { Content, Sider } = Layout;

type Props = {|
  activeUser: APIUser,
|};
type PropsWithRouter = {|
  ...Props,
  history: RouterHistory,
|};

const renderSampleDatasetsModal = (user: APIUser, history: RouterHistory) => {
  renderIndependently(destroy => (
    <SampleDatasetsModal
      organizationName={user.organization}
      destroy={destroy}
      onOk={() => history.push("/dashboard/datasets")}
    />
  ));
};

const fetchCategorizedDatastores = async (): Promise<{
  own: Array<APIDataStore>,
  wkConnect: Array<APIDataStore>,
}> => {
  const fetchedDatastores = await getDatastores();
  return {
    own: fetchedDatastores.filter(ds => !ds.isForeign && !ds.isConnector),
    wkConnect: fetchedDatastores.filter(ds => ds.isConnector),
  };
};

const DatasetAddView = ({ history, activeUser }: PropsWithRouter) => {
  const datastores = useFetch(fetchCategorizedDatastores, { own: [], wkConnect: [] }, []);
  const [datasetName, setDatasetName] = useState("");
  const [organization, setOrganization] = useState("");
  const [datasetNeedsConversion, setDatasetNeedsConversion] = useState(false);

  const handleDatasetAdded = async (
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion: ?boolean,
  ): Promise<void> => {
    setOrganization(datasetOrganization);
    setDatasetName(uploadedDatasetName);
    setDatasetNeedsConversion(needsConversion);
  };

  const showAfterUploadContent = datasetName !== "";

  const getAfterUploadModalContent = () => {
    if (!showAfterUploadContent) {
      return null;
    }
    return (
      <div style={{ fontSize: 20, paddingTop: 13, textAlign: "center" }}>
        The dataset was uploaded successfully
        {datasetNeedsConversion ? " and a conversion job was started." : null}.
        <br />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div className="centered-items" style={{ marginTop: 10 }}>
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

  return (
    <React.Fragment>
      <Layout>
        <Content>
          <Tabs defaultActiveKey="1" className="container">
            <TabPane
              tab={
                <span>
                  <UploadOutlined />
                  Upload Dataset
                </span>
              }
              key="1"
            >
              <DatasetUploadView datastores={datastores.own} onUploaded={handleDatasetAdded} />
            </TabPane>
            {datastores.wkConnect.length > 0 && (
              <TabPane
                tab={
                  <span>
                    <GoogleOutlined />
                    Add Neuroglancer Dataset
                  </span>
                }
                key="2"
              >
                <DatasetAddNeuroglancerView
                  datastores={datastores.wkConnect}
                  onAdded={handleDatasetAdded}
                />
              </TabPane>
            )}
            {datastores.wkConnect.length > 0 && (
              <TabPane
                tab={
                  <span>
                    <DatabaseOutlined />
                    Add BossDB Dataset
                  </span>
                }
                key="3"
              >
                <DatasetAddBossView
                  datastores={datastores.wkConnect}
                  onAdded={handleDatasetAdded}
                />
              </TabPane>
            )}
            {features().addForeignDataset && (
              <TabPane
                tab={
                  <span>
                    <BarsOutlined />
                    Add Foreign Dataset
                  </span>
                }
                key="4"
              >
                <DatasetAddForeignView onAdded={() => history.push("/dashboard")} />
              </TabPane>
            )}
          </Tabs>
          <div style={{ textAlign: "center" }}>
            <p>or</p>
            <p>
              <LinkButton onClick={() => renderSampleDatasetsModal(activeUser, history)}>
                Add a Sample Dataset
              </LinkButton>
            </p>
          </div>
        </Content>
        <VoxelyticsBanner />
      </Layout>
      <Modal
        visible={showAfterUploadContent}
        closable={showAfterUploadContent}
        keyboard={showAfterUploadContent}
        maskClosable={false}
        className="no-footer-modal"
        cancelButtonProps={{ style: { display: "none" } }}
        okButtonProps={{ style: { display: "none" } }}
        onCancel={() => setDatasetName("")}
        onOk={() => setDatasetName("")}
        width={580}
      >
        {showAfterUploadContent && getAfterUploadModalContent()}
      </Modal>
    </React.Fragment>
  );
};

function VoxelyticsBanner() {
  const [showSegmentationBanner] = useState(Math.random() > 0.5);

  // if (!features().isDemoInstance) {
  //   return null;
  // }

  const segmentationBanner = (
    <div
      className="crosslink-box"
      style={{
        background: "url(/assets/images/vx/segmentation-l4dense_motta_et_al_demo_rotated.jpg)",
        height: 500,
        backgroundSize: "110%",
        padding: 0,
      }}
    >
      <div
        style={{
          padding: "180px 10px 213px",
          background:
            "linear-gradient(181deg, transparent, rgb(59 59 59 / 20%), rgba(20, 19, 31, 0.84), #48484833, transparent)",
        }}
      >
        <h4 style={{ color: "white", textAlign: "center" }}>
          Are you looking for an automated segmentation of this dataset?
        </h4>
        <Button
          href="https://webknossos.org/services/automated-segmentation"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "block", margin: "10px auto", width: "50%" }}
        >
          Learn More
        </Button>
      </div>
    </div>
  );
  const alignBanner = (
    <div className="crosslink-box">
      <h4 style={{ fontWeight: "bold", textAlign: "center" }}>
        Are you looking for dataset alignment or stitching?
      </h4>
      <img
        src="/assets/images/vx/alignment-schema.png"
        alt="Schematic Alignment"
        style={{ width: "100%" }}
      />
      <Button
        href="https://webknossos.org/services/alignment"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "block", margin: "10px auto", width: "50%" }}
      >
        Learn More
      </Button>
    </div>
  );

  return (
    <Sider className="hide-on-small-screen" width={300}>
      {showSegmentationBanner ? segmentationBanner : alignBanner}
    </Sider>
  );
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(withRouter(DatasetAddView));
