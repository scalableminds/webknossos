import { PlanAboutToExceedAlert, PlanExceededAlert } from "admin/organization/organization_cards";
import {
  cachedGetPricingPlanStatus,
  getUser,
  updateNovelUserExperienceInfos,
} from "admin/rest_api";
import { WhatsNextHeader } from "admin/welcome_ui";
import { Spin, Tabs } from "antd";
import DashboardTaskListView from "dashboard/dashboard_task_list_view";
import ExplorativeAnnotationsView from "dashboard/explorative_annotations_view";
import { PublicationViewWithHeader } from "dashboard/publication_view";
import features from "features";
import Request from "libs/request";
import UserLocalStorage from "libs/user_local_storage";
import { type RouteComponentProps, withRouter } from "libs/with_router_hoc";
import _ from "lodash";
import type React from "react";
import { PureComponent } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { APIOrganization, APIPricingPlanStatus, APIUser } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import type { WebknossosState } from "viewer/store";
import { PortalTarget } from "viewer/view/layouting/portal_utils";
import NmlUploadZoneContainer from "viewer/view/nml_upload_zone_container";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";
import { DatasetFolderView } from "./dataset_folder_view";

type OwnProps = {
  userId: string | null | undefined;
  isAdminView: boolean;
  initialTabKey: string | null | undefined;
};
type StateProps = {
  activeUser: APIUser;
  activeOrganization: APIOrganization;
};
type DispatchProps = {
  updateActiveUser: (arg0: APIUser) => void;
};
type Props = OwnProps & StateProps & DispatchProps;
type PropsWithRouter = Props & RouteComponentProps;
type State = {
  activeTabKey: string;
  user: APIUser | null | undefined;
  organization: APIOrganization | null;
  pricingPlanStatus: APIPricingPlanStatus | null;
};

export const urlTokenToTabKeyMap = {
  publications: "publications",
  datasets: "datasets",
  tasks: "tasks",
  annotations: "explorativeAnnotations",
};

function TabBarExtraContent() {
  return (
    <PortalTarget
      portalId="dashboard-TabBarExtraContent"
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
      defaultTabKey = "explorativeAnnotations";
    } else if (features().isWkorgInstance) {
      defaultTabKey = "publications";
    }

    const activeTabKey =
      (initialTabKey && validTabKeys[initialTabKey] ? initialTabKey : null) ||
      (lastUsedTabKey && validTabKeys[lastUsedTabKey] ? lastUsedTabKey : null) ||
      defaultTabKey;

    this.state = {
      activeTabKey,
      user: null,
      organization: null,
      pricingPlanStatus: null,
    };
  }

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(prevProps: PropsWithRouter) {
    if (this.props.initialTabKey != null && prevProps.initialTabKey !== this.props.initialTabKey) {
      this.setState({
        activeTabKey: this.props.initialTabKey,
      });
    }
  }

  async fetchData(): Promise<void> {
    const user =
      this.props.userId != null ? await getUser(this.props.userId) : this.props.activeUser;

    // Use a cached version of this route to avoid that a tab switch in the dashboard
    // causes a whole-page spinner. Since the different tabs are controlled by the
    // router, the DashboardView re-mounts.
    const pricingPlanStatus = await cachedGetPricingPlanStatus();

    this.setState({
      user,
      pricingPlanStatus,
    });
  }

  uploadNmls = async (files: Array<File>, createGroupForEachFile: boolean): Promise<void> => {
    const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
      data: {
        nmlFile: files,
        createGroupForEachFile,
      },
    });
    this.props.navigate(`/annotations/${response.annotation.id}`);
  };

  getValidTabKeys() {
    const { isAdminView } = this.props;
    return {
      publications: features().isWkorgInstance,
      datasets: !isAdminView,
      tasks: true,
      explorativeAnnotations: true,
    } as { [key: string]: boolean };
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
              label: <span>Datasets</span>,
              key: "datasets",
              children: (
                <RenderingTabContext.Provider value="datasets">
                  <DatasetFolderView user={user} />
                </RenderingTabContext.Provider>
              ),
            }
          : null,
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
          this.props.navigate(`/dashboard/${url}`);
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
    this.state.pricingPlanStatus?.isAlmostExceeded;

    const pricingPlanWarnings =
      this.props.activeOrganization &&
      this.state.pricingPlanStatus?.isAlmostExceeded &&
      !this.state.pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={this.props.activeOrganization} />
      ) : null;
    const pricingPlanErrors =
      this.props.activeOrganization && this.state.pricingPlanStatus?.isExceeded ? (
        <PlanExceededAlert organization={this.props.activeOrganization} />
      ) : null;

    return (
      <NmlUploadZoneContainer onImport={this.uploadNmls} isUpdateAllowed>
        {whatsNextBanner}
        <div className="container propagate-flex-height" style={{ minHeight: "66vh" }}>
          {pricingPlanWarnings}
          {pricingPlanErrors}
          {userHeader}

          <ActiveTabContext.Provider value={this.state.activeTabKey}>
            <Tabs
              activeKey={this.state.activeTabKey}
              onChange={onTabChange}
              items={this.getTabs(user)}
              tabBarExtraContent={<TabBarExtraContent />}
            />
          </ActiveTabContext.Provider>
        </div>
      </NmlUploadZoneContainer>
    );
  }
}

const mapStateToProps = (state: WebknossosState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
  activeOrganization: enforceActiveOrganization(state.activeOrganization),
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  updateActiveUser(activeUser: APIUser) {
    dispatch(setActiveUserAction(activeUser));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(withRouter(DashboardView));
