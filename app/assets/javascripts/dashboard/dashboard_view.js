// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import { connect } from "react-redux";
import { Spin, Tabs } from "antd";
import DatasetView from "dashboard/dataset_view";
import DashboardTaskListView from "dashboard/dashboard_task_list_view";
import ExplorativeAnnotationsView from "dashboard/explorative_annotations_view";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getUser } from "admin/admin_rest_api";
import type { APIUserType, APIDatasetType } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { handleGenericError } from "libs/error_handling";
import { getDatastores, triggerDatasetCheck, getDatasets } from "admin/admin_rest_api";
import { parseAsMaybe } from "libs/utils";

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
  datasets: Array<APIDatasetType>,
  isLoadingDatasets: boolean,
};

export const wkDatasetsCacheKey = "wk.datasets";
export const datasetCache = {
  set(datasets: APIDatasetType[]): void {
    localStorage.setItem("wk.datasets", JSON.stringify(datasets));
  },
  get(): APIDatasetType[] {
    return parseAsMaybe(localStorage.getItem(wkDatasetsCacheKey)).getOrElse([]);
  },
  clear(): void {
    localStorage.removeItem(wkDatasetsCacheKey);
  },
};

class DashboardView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);

    const lastUsedTabKey = localStorage.getItem("lastUsedDashboardTab");
    const isValid = lastUsedTabKey && validTabKeys.indexOf(lastUsedTabKey) > -1;
    const defaultTab = this.props.isAdminView ? "tasks" : "datasets";

    const cachedDatasets = datasetCache.get();

    this.state = {
      activeTabKey: lastUsedTabKey && isValid ? lastUsedTabKey : defaultTab,
      user: null,
      isLoadingDatasets: false,
      datasets: cachedDatasets,
    };
  }

  componentDidCatch(error: Error) {
    // An unknown error was thrown. To avoid any problems with the caching of datasets,
    // we simply clear the cache for the datasets and re-fetch.
    this.setState({ datasets: [] });
    datasetCache.clear();
    this.fetchDatasets();
  }

  componentDidMount() {
    this.fetchUser();
    this.fetchDatasets();
  }

  handleCheckDatasets = async (): Promise<void> => {
    if (this.state.isLoadingDatasets) return;

    try {
      this.setState({ isLoadingDatasets: true });
      const datastores = await getDatastores();
      await Promise.all(datastores.map(datastore => triggerDatasetCheck(datastore.url)));
      await this.fetchDatasets();
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoadingDatasets: false });
    }
  };

  async fetchUser(): Promise<void> {
    const user =
      this.props.userId != null ? await getUser(this.props.userId) : this.props.activeUser;

    this.setState({ user });
  }

  async fetchDatasets(): Promise<void> {
    try {
      this.setState({ isLoadingDatasets: true });
      const datasets = await getDatasets();
      datasetCache.set(datasets);

      // todo: before setting datasets here, replace the LRU counts by the old ones
      // datasets.forEach(dataset => {

      // })

      this.setState({
        datasets,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoadingDatasets: false });
    }
  }

  getTabs(user: APIUserType) {
    if (this.props.activeUser) {
      const isAdminView = this.props.isAdminView;

      const datasetViewProps = {
        user,
        onCheckDatasets: this.handleCheckDatasets,
        datasets: this.state.datasets,
        isLoading: this.state.isLoadingDatasets,
      };

      return [
        !isAdminView ? (
          <TabPane tab="Dataset Gallery" key="datasets">
            <DatasetView {...datasetViewProps} dataViewType="gallery" />
          </TabPane>
        ) : null,
        !isAdminView ? (
          <TabPane tab="Datasets" key="advanced-datasets">
            <DatasetView {...datasetViewProps} dataViewType="advanced" />
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
      ];
    } else {
      return null;
    }
  }

  render() {
    const user = this.state.user;
    if (!user) {
      return (
        <div className="text-center" style={{ marginTop: 50, width: "100vw" }}>
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
      <div className="container">
        {userHeader}
        <Tabs activeKey={this.state.activeTabKey} onChange={onTabChange} style={{ marginTop: 20 }}>
          {this.getTabs(user)}
        </Tabs>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(DashboardView);
