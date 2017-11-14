// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import { connect } from "react-redux";
import Request from "libs/request";
import { Spin, Tabs } from "antd";
import Utils from "libs/utils";
import DatasetView from "dashboard/views/dataset_view";
import DashboardTaskListView from "dashboard/views/dashboard_task_list_view";
import ExplorativeAnnotationsView from "dashboard/views/explorative_annotations_view";
import LoggedTimeView from "dashboard/views/logged_time_view";
import { getActiveUser } from "oxalis/model/accessors/user_accessor";

import type { APIUserType } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";

const TabPane = Tabs.TabPane;

const validTabKeys = ["datasets", "advanced-datasets", "tasks", "explorativeAnnotations"];

type OwnProps = {
  userId: ?string,
  isAdminView: boolean,
};

type StateProps = {
  activeUser: APIUserType,
};

type Props = OwnProps & StateProps;

type State = {
  activeTabKey: string,
  user: ?APIUserType,
};

class DashboardView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);

    const lastUsedTabKey = localStorage.getItem("lastUsedDashboardTab");
    const isValid = lastUsedTabKey && validTabKeys.indexOf(lastUsedTabKey) > -1;
    const defaultTab = this.props.isAdminView ? "tasks" : "datasets";
    this.state = {
      activeTabKey: lastUsedTabKey && isValid ? lastUsedTabKey : defaultTab,
      user: null,
    };
  }

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = this.props.userId ? `/api/users/${this.props.userId}` : "/api/user";
    const user = await Request.receiveJSON(url);

    this.setState({
      user,
    });
  }

  getTabs(user: APIUserType) {
    if (this.props.activeUser) {
      const isUserAdmin = Utils.isUserAdmin(this.props.activeUser);
      const isAdminView = this.props.isAdminView;

      return [
        !isAdminView ? (
          <TabPane tab="Dataset Gallery" key="datasets">
            <DatasetView user={user} dataViewType="gallery" />
          </TabPane>
        ) : null,
        !isAdminView && isUserAdmin ? (
          <TabPane tab="Datasets" key="advanced-datasets">
            <DatasetView user={user} dataViewType="advanced" />
          </TabPane>
        ) : null,
        <TabPane tab="Tasks" key="tasks">
          <DashboardTaskListView isAdminView={this.props.isAdminView} userId={this.props.userId} />
        </TabPane>,
        <TabPane tab="Explorative Annotations" key="explorativeAnnotations">
          <ExplorativeAnnotationsView
            isAdminView={this.props.isAdminView}
            userId={this.props.userId}
          />
        </TabPane>,
        isAdminView ? (
          <TabPane tab="Tracked Time" key="trackedTime">
            <LoggedTimeView userId={this.props.userId} />
          </TabPane>
        ) : null,
      ];
    } else {
      return null;
    }
  }

  render() {
    const user = this.state.user;
    if (!user) {
      return (
        <div className="text-center" style={{ marginTop: 50 }}>
          <Spin size="large" />
        </div>
      );
    }

    const onTabChange = activeTabKey => {
      const isValid = validTabKeys.indexOf(activeTabKey) > -1;
      if (isValid) {
        localStorage.setItem("lastUsedDashboardTab", activeTabKey);
      }
      this.setState({ activeTabKey });
    };
    const userHeader = this.props.isAdminView ? (
      <h3>
        User: {user.firstName} {user.lastName}
      </h3>
    ) : null;

    return (
      <div id="dashboard" className="container wide">
        {userHeader}
        <Tabs activeKey={this.state.activeTabKey} onChange={onTabChange} style={{ marginTop: 20 }}>
          {this.getTabs(user)}
        </Tabs>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: getActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(DashboardView);
