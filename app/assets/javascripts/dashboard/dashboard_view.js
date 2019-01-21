// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import { type RouterHistory, withRouter } from "react-router-dom";
import { Spin, Tabs } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";

import type { APIUser, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getUser, getDatastores, triggerDatasetCheck, getDatasets } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import { parseAsMaybe } from "libs/utils";
import DashboardTaskListView from "dashboard/dashboard_task_list_view";
import DatasetView from "dashboard/dataset_view";
import ExplorativeAnnotationsView from "dashboard/explorative_annotations_view";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import Request from "libs/request";

const TabPane = Tabs.TabPane;

const validTabKeys = ["publications", "advanced-datasets", "tasks", "explorativeAnnotations"];

type OwnProps = {
  userId: ?string,
  isAdminView: boolean,
  history: RouterHistory,
  initialTabKey: ?string,
};

type StateProps = {
  activeUser: APIUser,
};

type Props = OwnProps & StateProps;

type State = {
  activeTabKey: string,
  user: ?APIUser,
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoadingDatasets: boolean,
};

export const wkDatasetsCacheKey = "wk.datasets";
export const datasetCache = {
  set(datasets: APIMaybeUnimportedDataset[]): void {
    localStorage.setItem("wk.datasets", JSON.stringify(datasets));
  },
  get(): APIMaybeUnimportedDataset[] {
    return parseAsMaybe(localStorage.getItem(wkDatasetsCacheKey)).getOrElse([]);
  },
  clear(): void {
    localStorage.removeItem(wkDatasetsCacheKey);
  },
};

export const urlTokenToTabKeyMap = {
  gallery: "publications",
  datasets: "advanced-datasets",
  tasks: "tasks",
  annotations: "explorativeAnnotations",
};

class DashboardView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);

    const lastUsedTabKey = localStorage.getItem("lastUsedDashboardTab");
    const isValid = lastUsedTabKey && validTabKeys.indexOf(lastUsedTabKey) > -1;
    const defaultTab = this.props.isAdminView ? "tasks" : "datasets";

    const cachedDatasets = datasetCache.get();

    const initialTabKey =
      this.props.initialTabKey || (lastUsedTabKey && isValid ? lastUsedTabKey : defaultTab);
    this.state = {
      activeTabKey: initialTabKey,
      user: null,
      isLoadingDatasets: false,
      datasets: cachedDatasets,
    };
  }

  componentDidMount() {
    this.fetchUser();
    this.fetchDatasets();
  }

  componentDidCatch(error: Error) {
    console.error(error);
    // An unknown error was thrown. To avoid any problems with the caching of datasets,
    // we simply clear the cache for the datasets and re-fetch.
    this.setState({ datasets: [] });
    datasetCache.clear();
    this.fetchDatasets();
  }

  handleCheckDatasets = async (): Promise<void> => {
    if (this.state.isLoadingDatasets) return;

    try {
      this.setState({ isLoadingDatasets: true });
      const datastores = await getDatastores();
      await Promise.all(
        datastores.filter(ds => !ds.isForeign).map(datastore => triggerDatasetCheck(datastore.url)),
      );
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

  uploadNmls = async (files: Array<File>, createGroupForEachFile: boolean): Promise<void> => {
    const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
      data: { nmlFile: files, createGroupForEachFile },
    });
    this.props.history.push(`/annotations/${response.annotation.typ}/${response.annotation.id}`);
  };

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

  getTabs(user: APIUser) {
    if (this.props.activeUser) {
      const { isAdminView } = this.props;

      const datasetViewProps = {
        user,
        onCheckDatasets: this.handleCheckDatasets,
        datasets: this.state.datasets,
        isLoading: this.state.isLoadingDatasets,
      };

      return [
        !isAdminView ? (
          <TabPane tab="Publications" key="publications">
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
        localStorage.setItem("lastUsedDashboardTab", activeTabKey);
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

    return (
      <NmlUploadZoneContainer onImport={this.uploadNmls} isAllowed>
        <div className="container">
          {userHeader}
          <Tabs
            activeKey={this.state.activeTabKey}
            onChange={onTabChange}
            style={{ marginTop: 20 }}
          >
            {this.getTabs(user)}
          </Tabs>
        </div>
      </NmlUploadZoneContainer>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(DashboardView));
