// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Modal, Button } from "antd";
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
            <DatasetAddBossView datastores={datastores.wkConnect} onAdded={handleDatasetAdded} />
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

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(withRouter(DatasetAddView));
