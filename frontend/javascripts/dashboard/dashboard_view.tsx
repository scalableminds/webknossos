import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import { Spin, Tabs } from "antd";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import React, { PureComponent, useContext } from "react";
import _ from "lodash";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { WhatsNextHeader } from "admin/welcome_ui";
import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getUser, updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import DashboardTaskListView from "dashboard/dashboard_task_list_view";
import DatasetView from "dashboard/dataset_view";
import DatasetCacheProvider, {
  DatasetCacheContext,
} from "dashboard/dataset/dataset_cache_provider";
import { PublicationViewWithHeader } from "dashboard/publication_view";
import ExplorativeAnnotationsView from "dashboard/explorative_annotations_view";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import Request from "libs/request";
import UserLocalStorage from "libs/user_local_storage";
import features from "features";
import { DatasetFolderView } from "./dataset_folder_view";
import { PortalTarget } from "oxalis/view/layouting/portal_utils";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";

type OwnProps = {
  userId: string | null | undefined;
  isAdminView: boolean;
  initialTabKey: string | null | undefined;
};
type StateProps = {
  activeUser: APIUser;
};
type DispatchProps = {
  updateActiveUser: (arg0: APIUser) => void;
};
type Props = OwnProps & StateProps & DispatchProps;
type PropsWithRouter = Props & {
  history: RouteComponentProps["history"];
};
type State = {
  activeTabKey: string;
  user: APIUser | null | undefined;
};
export const urlTokenToTabKeyMap = {
  publications: "publications",
  datasets: "datasets",
  datasetsFolders: "datasetsFolders",
  tasks: "tasks",
  annotations: "explorativeAnnotations",
};

function TabBarExtraContent({ activeTabKey }: { activeTabKey: string }) {
  return (
    <PortalTarget
      portalId={"dashboard-TabBarExtraContent"}
      style={{
        flex: 1,
        display: "flex",
      }}
    />
  );
}

type Tab = {
  label: string;
  key: string;
  children: React.ReactElement;
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
      (initialTabKey && initialTabKey in validTabKeys && initialTabKey) ||
      (lastUsedTabKey && lastUsedTabKey in validTabKeys && lastUsedTabKey) ||
      defaultTabKey;
    this.state = {
      activeTabKey,
      user: null,
    };
  }

  componentDidMount() {
    this.fetchUser();
  }

  componentDidUpdate(prevProps: PropsWithRouter) {
    if (this.props.initialTabKey != null && prevProps.initialTabKey !== this.props.initialTabKey) {
      this.setState({
        activeTabKey: this.props.initialTabKey,
      });
    }
  }

  async fetchUser(): Promise<void> {
    const user =
      this.props.userId != null ? await getUser(this.props.userId) : this.props.activeUser;
    this.setState({
      user,
    });
  }

  uploadNmls = async (files: Array<File>, createGroupForEachFile: boolean): Promise<void> => {
    const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
      data: {
        nmlFile: files,
        createGroupForEachFile,
      },
    });
    this.props.history.push(`/annotations/${response.annotation.id}`);
  };

  getValidTabKeys() {
    const { isAdminView } = this.props;
    return {
      publications: features().isDemoInstance,
      datasets: !isAdminView,
      tasks: true,
      explorativeAnnotations: true,
      datasetsFolders: true,
    };
  }

  getTabs(user: APIUser): Tab[] {
    if (this.props.activeUser) {
      const validTabKeys = this.getValidTabKeys();
      const tabs = [
        validTabKeys.publications
          ? {
              label: "Featured Publications",
              key: "publications",
              children: (
                <RenderingTabContext.Provider value="publications">
                  <PublicationViewWithHeader />
                </RenderingTabContext.Provider>
              ),
            }
          : null,
        validTabKeys.datasets
          ? {
              label: "Datasets",
              key: "datasets",
              children: (
                <RenderingTabContext.Provider value="datasets">
                  <DatasetViewWithLegacyContext user={user} />
                </RenderingTabContext.Provider>
              ),
            }
          : null,
        {
          label: "Dataset (Folders)",
          key: "datasetsFolders",
          children: (
            <RenderingTabContext.Provider value="datasetsFolders">
              <DatasetFolderView user={user} />
            </RenderingTabContext.Provider>
          ),
        },
        {
          label: "Tasks",
          key: "tasks",
          children: (
            <RenderingTabContext.Provider value="tasks">
              <DashboardTaskListView
                isAdminView={this.props.isAdminView}
                userId={this.props.userId}
              />
            </RenderingTabContext.Provider>
          ),
        },
        {
          label: "Annotations",
          key: "explorativeAnnotations",
          children: (
            <RenderingTabContext.Provider value="explorativeAnnotations">
              <ExplorativeAnnotationsView
                isAdminView={this.props.isAdminView}
                userId={this.props.userId}
                activeUser={this.props.activeUser}
              />
            </RenderingTabContext.Provider>
          ),
        },
      ];

      return tabs.filter((el) => el != null) as Tab[];
    } else {
      return [];
    }
  }

  onDismissWelcomeBanner = () => {
    const [newUserSync] = updateNovelUserExperienceInfos(this.props.activeUser, {
      hasSeenDashboardWelcomeBanner: true,
    });
    this.props.updateActiveUser(newUserSync);
  };

  render() {
    const { user } = this.state;
    const { activeUser } = this.props;

    if (!user) {
      return (
        <div
          className="text-center"
          style={{
            marginTop: 50,
            width: "100vw",
          }}
        >
          <Spin size="large" />
        </div>
      );
    }

    const onTabChange = (activeTabKey: string) => {
      const tabKeyToURLMap = _.invert(urlTokenToTabKeyMap);

      const url = tabKeyToURLMap[activeTabKey];

      if (url) {
        UserLocalStorage.setItem("lastUsedDashboardTab", activeTabKey);

        if (!this.props.isAdminView) {
          this.props.history.push(`/dashboard/${url}`);
        }
      }

      this.setState({
        activeTabKey,
      });
    };

    const userHeader = this.props.isAdminView ? (
      <h3>
        User: {user.firstName} {user.lastName}
      </h3>
    ) : null;
    const whatsNextBanner =
      !this.props.isAdminView &&
      !activeUser.novelUserExperienceInfos.hasSeenDashboardWelcomeBanner ? (
        <WhatsNextHeader activeUser={activeUser} onDismiss={this.onDismissWelcomeBanner} />
      ) : null;
    return (
      <NmlUploadZoneContainer onImport={this.uploadNmls} isUpdateAllowed>
        {whatsNextBanner}
        <div className="container">
          {userHeader}
          <DatasetCacheProvider>
            <ActiveTabContext.Provider value={this.state.activeTabKey}>
              <Tabs
                activeKey={this.state.activeTabKey}
                onChange={onTabChange}
                items={this.getTabs(user)}
                tabBarExtraContent={
                  <TabBarExtraContent
                    key={this.state.activeTabKey}
                    activeTabKey={this.state.activeTabKey}
                  />
                }
              />
            </ActiveTabContext.Provider>
          </DatasetCacheProvider>
        </div>
      </NmlUploadZoneContainer>
    );
  }
}
function DatasetViewWithLegacyContext({ user }: { user: APIUser }) {
  const datasetCacheContext = useContext(DatasetCacheContext);
  return <DatasetView user={user} hideDetailsColumns={false} context={datasetCacheContext} />;
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  updateActiveUser(activeUser: APIUser) {
    dispatch(setActiveUserAction(activeUser));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(withRouter<RouteComponentProps & Props, any>(DashboardView));
