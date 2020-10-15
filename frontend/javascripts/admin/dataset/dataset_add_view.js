// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Icon } from "antd";
import React from "react";
import { connect } from "react-redux";
import _ from "lodash";

import type { APIUser, APIDataStore } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import DatasetAddNeuroglancerView from "admin/dataset/dataset_add_neuroglancer_view";
import DatasetAddBossView from "admin/dataset/dataset_add_boss_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import features from "features";
import { getDatastores, startJob } from "admin/admin_rest_api";
import renderIndependently from "libs/render_independently";
import { useFetch } from "libs/react_helpers";
import { type Vector3 } from "oxalis/constants";

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

  const handleDatasetAdded = (
    organization: string,
    datasetName: string,
    needsConversion: ?boolean,
    scale: ?Vector3,
  ) => {
    if (needsConversion && scale) {
      startJob(datasetName, organization, scale);
      const url = "/jobs";
      history.push(url);
    } else {
      const url = `/datasets/${organization}/${datasetName}/import`;
      history.push(url);
    }
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
                <Icon type="google" />
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
                <Icon type="database" />
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
                <Icon type="bars" />
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
