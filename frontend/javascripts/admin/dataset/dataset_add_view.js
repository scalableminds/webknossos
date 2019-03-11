// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Icon } from "antd";
import React from "react";
import { connect } from "react-redux";
import _ from "lodash";

import type { APIUser } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import features from "features";
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

const DatasetAddView = ({ history, activeUser }: PropsWithRouter) => (
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
        <DatasetUploadView
          onUploaded={(organization: string, datasetName: string) => {
            const url = `/datasets/${organization}/${datasetName}/import`;
            history.push(url);
          }}
        />
      </TabPane>
      {features().addForeignDataset ? (
        <TabPane
          tab={
            <span>
              <Icon type="bars" />
              Add foreign Dataset
            </span>
          }
          key="2"
        >
          <DatasetAddForeignView onAdded={() => history.push("/dashboard")} />
        </TabPane>
      ) : null}
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

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(withRouter(DatasetAddView));
