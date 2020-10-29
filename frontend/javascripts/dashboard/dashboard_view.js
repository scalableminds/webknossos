// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Spin, Tabs } from "antd";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import _ from "lodash";
import * as Utils from "libs/utils";

import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getUser } from "admin/admin_rest_api";
import DashboardTaskListView from "dashboard/dashboard_task_list_view";
import DatasetView from "dashboard/dataset_view";
import DatasetCacheProvider from "dashboard/dataset/dataset_cache_provider";
import { PublicationViewWithHeader } from "dashboard/publication_view";
import ExplorativeAnnotationsView from "dashboard/explorative_annotations_view";
import SharedAnnotationsView from "dashboard/shared_annotations_view";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import { WhatsNextBanner } from "admin/onboarding";
import Request from "libs/request";
import UserLocalStorage from "libs/user_local_storage";
import features from "features";

const { TabPane } = Tabs;

type OwnProps = {|
  userId: ?string,
  isAdminView: boolean,
  initialTabKey: ?string,
|};
type StateProps = {|
  activeUser: APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {| ...Props, history: RouterHistory |};

type State = {
  activeTabKey: string,
  user: ?APIUser,
  showWhatsNextBanner: boolean,
};

export const urlTokenToTabKeyMap = {
  publications: "publications",
  datasets: "datasets",
  tasks: "tasks",
  annotations: "explorativeAnnotations",
  shared: "sharedAnnotations",
};

class DashboardView extends PureComponent<PropsWithRouter, State> {
  constructor(props: PropsWithRouter) {
    super(props);

    const validTabKeys = this.getValidTabKeys();
    const { initialTabKey } = this.props;
    const lastUsedTabKey = UserLocalStorage.getItem("lastUsedDashboardTab");
    let defaultTabKey = "datasets";
    if (this.props.isAdminView) {
      defaultTabKey = "tasks";
    } else if (features().isDemoInstance) {
      defaultTabKey = "publications";
    }

    // Flow doesn't allow validTabKeys[key] where key may be null, so check that first
    const activeTabKey =
      (initialTabKey && validTabKeys[initialTabKey] && initialTabKey) ||
      (lastUsedTabKey && validTabKeys[lastUsedTabKey] && lastUsedTabKey) ||
      defaultTabKey;
    this.state = {
      activeTabKey,
      user: null,
      showWhatsNextBanner: Utils.getUrlParamValue("showWhatsNextBanner") === "true",
    };
  }

  componentDidMount() {
    this.fetchUser();
  }

  componentWillReceiveProps(newProps: PropsWithRouter) {
    if (newProps.initialTabKey != null && newProps.initialTabKey !== this.props.initialTabKey) {
      this.setState({ activeTabKey: newProps.initialTabKey });
    }
  }

  async fetchUser(): Promise<void> {
    const user =
      this.props.userId != null ? await getUser(this.props.userId) : this.props.activeUser;

    this.setState({ user });
  }

  uploadNmls = async (files: Array<File>, createGroupForEachFile: boolean): Promise<void> => {
    const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
      data: { nmlFile: files, createGroupForEachFile },
    });
    this.props.history.push(`/annotations/${response.annotation.typ}/${response.annotation.id}`);
  };

  getValidTabKeys() {
    const { isAdminView } = this.props;

    return {
      publications: features().isDemoInstance,
      datasets: !isAdminView,
      tasks: true,
      explorativeAnnotations: true,
      sharedAnnotations: true,
    };
  }

  getTabs(user: APIUser) {
    if (this.props.activeUser) {
      const validTabKeys = this.getValidTabKeys();

      return [
        validTabKeys.publications ? (
          <TabPane tab="Featured Publications" key="publications">
            <PublicationViewWithHeader />
          </TabPane>
        ) : null,
        validTabKeys.datasets ? (
          <TabPane tab="My Datasets" key="datasets">
            <DatasetView user={user} />
          </TabPane>
        ) : null,
        <TabPane tab="My Tasks" key="tasks">
          <DashboardTaskListView isAdminView={this.props.isAdminView} userId={this.props.userId} />
        </TabPane>,
        <TabPane tab="My Annotations" key="explorativeAnnotations">
          <ExplorativeAnnotationsView
            isAdminView={this.props.isAdminView}
            userId={this.props.userId}
          />
        </TabPane>,
        <TabPane tab="Shared Annotations" key="sharedAnnotations">
          <SharedAnnotationsView />
        </TabPane>,
      ];
    } else {
      return null;
    }
  }

  render() {
    const { user } = this.state;
    if (!user) {
      return (
        <div className="text-center" style={{ marginTop: 50, width: "100vw" }}>
          <Spin size="large" />
        </div>
      );
    }

    const onTabChange = activeTabKey => {
      const tabKeyToURLMap = _.invert(urlTokenToTabKeyMap);
      const url = tabKeyToURLMap[activeTabKey];
      if (url) {
        UserLocalStorage.setItem("lastUsedDashboardTab", activeTabKey);
        if (!this.props.isAdminView) {
          this.props.history.push(`/dashboard/${url}`);
        }
      }

      this.setState({ activeTabKey });
    };
    const userHeader = this.props.isAdminView ? (
      <h3>
        User: {user.firstName} {user.lastName}
      </h3>
    ) : null;

    const whatsNextBanner = this.state.showWhatsNextBanner ? (
      <WhatsNextBanner activeUser={this.props.activeUser} />
    ) : null;

    return (
      <NmlUploadZoneContainer onImport={this.uploadNmls} isUpdateAllowed>
        <div className="container" style={{ paddingBottom: 50 }}>
          {whatsNextBanner}
          {userHeader}
          <DatasetCacheProvider>
            <Tabs activeKey={this.state.activeTabKey} onChange={onTabChange}>
              {this.getTabs(user)}
            </Tabs>
          </DatasetCacheProvider>
        </div>
      </NmlUploadZoneContainer>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(DashboardView));
