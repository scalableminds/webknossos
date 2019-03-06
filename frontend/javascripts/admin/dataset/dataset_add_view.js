// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Icon } from "antd";
import React, { useState, useEffect } from "react";
import { connect } from "react-redux";
import _ from "lodash";

import type { APIUser, APIDataStore } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import DatasetAddWkConnectView from "admin/dataset/dataset_add_wk_connect_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import features from "features";
import { getDatastores } from "admin/admin_rest_api";
import renderIndependently from "libs/render_independently";

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

// TODO: Replace with useFetch once it is merged
function useDatastores(): { own: Array<APIDataStore>, wkConnect: Array<APIDataStore> } {
  const [datastores, setDatastores] = useState({ own: [], wkConnect: [] });
  const fetchDatastores = async () => {
    const fetchedDatastores = await getDatastores();
    const categorizedDatastores = {
      own: fetchedDatastores.filter(ds => !ds.isForeign && !ds.isConnector),
      wkConnect: fetchedDatastores.filter(ds => ds.isConnector),
    };
    setDatastores(categorizedDatastores);
  };
  useEffect(() => {
    fetchDatastores();
  }, []);
  return datastores;
}

const DatasetAddView = ({ history, activeUser }: PropsWithRouter) => {
  const datastores = useDatastores();

  const handleDatasetAdded = (organization: string, datasetName: string) => {
    const url = `/datasets/${organization}/${datasetName}/import`;
    history.push(url);
  };

  return (
    <React.Fragment>
      <Tabs defaultActiveKey="1" className="container">
        <TabPane
          tab={
            <span>
              <Icon type="upload" />
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
                <Icon type="plus" />
                Add Dataset via wk-connect
              </span>
            }
            key="2"
          >
            <DatasetAddWkConnectView
              datastores={datastores.wkConnect}
              onAdded={handleDatasetAdded}
            />
          </TabPane>
        )}
        {features().addForeignDataset && (
          <TabPane
            tab={
              <span>
                <Icon type="bars" />
                Add Foreign Dataset
              </span>
            }
            key="3"
          >
            <DatasetAddForeignView onAdded={() => history.push("/dashboard")} />
          </TabPane>
        )}
      </Tabs>
      <div style={{ textAlign: "center" }}>
        <p>or</p>
        <p>
          <a href="#" onClick={() => renderSampleDatasetsModal(activeUser, history)}>
            Add a Sample Dataset
          </a>
        </p>
      </div>
    </React.Fragment>
  );
};

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(withRouter(DatasetAddView));
