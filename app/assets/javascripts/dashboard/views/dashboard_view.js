// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import Request from "libs/request";
import { Spin, Tabs } from "antd";
import type { APIUserType } from "admin/api_flow_types";
import DatasetView from "./dataset_view";
import DashboardTaskListView from "./dashboard_task_list_view";
import ExplorativeAnnotationsView from "./explorative_annotations_view";
import LoggedTimeView from "./logged_time_view";

const TabPane = Tabs.TabPane;

const validTabKeys = ["datasets", "tasks", "explorativeAnnotations"];

type Props = {
  userID: ?string,
  isAdminView: boolean,
};

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
    const url = this.props.userID ? `/api/users/${this.props.userID}` : "/api/user";
    const user = await Request.receiveJSON(url);

    this.setState({
      user,
    });
  }

  getTabs(user: APIUserType) {
    const isAdmin = this.props.isAdminView;
    return [
      !isAdmin ? (
        <TabPane tab="Datasets" key="datasets">
          <DatasetView user={user} />
        </TabPane>
      ) : null,
      <TabPane tab="Tasks" key="tasks">
        <DashboardTaskListView isAdminView={this.props.isAdminView} userID={this.props.userID} />
      </TabPane>,
      <TabPane tab="Explorative Annotations" key="explorativeAnnotations">
        <ExplorativeAnnotationsView
          isAdminView={this.props.isAdminView}
          userID={this.props.userID}
        />
      </TabPane>,
      isAdmin ? (
        <TabPane tab="Tracked Time" key="trackedTime">
          <LoggedTimeView userID={this.props.userID} />
        </TabPane>
      ) : null,
    ];
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

export default DashboardView;
