import { DeleteOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { Breadcrumb, Layout, Menu } from "antd";
import type { MenuItemGroupType } from "antd/es/menu/interface";
import { connect } from "react-redux";
import { Route, Switch, useHistory, useLocation } from "react-router-dom";
import { Redirect } from "react-router-dom";
import type { APIOrganization } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import type { WebknossosState } from "viewer/store";
import { OrganizationDangerZoneView } from "./organization_dangerzone_view";
import { OrganizationNotificationsView } from "./organization_notifications_view";
import { OrganizationOverviewView } from "./organization_overview_view";
import { Store } from "viewer/singletons";

const { Sider, Content } = Layout;

type Props = {
  organization: APIOrganization;
};

const BREADCRUMB_LABELS = {
  overview: "Overview",
  notifications: "Notification Settings",
  delete: "Delete Organization",
};

const OrganizationView = ({ organization }: Props) => {
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").pop() || "overview";

  const menuItems: MenuItemGroupType[] = [
    {
      label: "Organization",
      type: "group",
      children: [
        {
          key: "overview",
          icon: <UserOutlined />,
          label: "Overview",
        },
        {
          key: "notifications",
          icon: <MailOutlined />,
          label: "Notifications",
        },
        {
          key: "delete",
          icon: <DeleteOutlined />,
          label: "Delete",
        },
      ],
    },
  ];

  const breadcrumbItems = [
    {
      title: "Organization",
    },
    {
      title: BREADCRUMB_LABELS[selectedKey as keyof typeof BREADCRUMB_LABELS],
    },
  ];

  return (
    <Layout
      style={{
        minHeight: "calc(100vh - 64px)",
        backgroundColor: "var(--ant-layout-body-bg)",
      }}
    >
      <Sider width={200}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ height: "100%", padding: 24 }}
          items={menuItems}
          onClick={({ key }) => history.push(`/organization/${key}`)}
        />
      </Sider>
      <Content style={{ padding: "32px", minHeight: 280, maxWidth: 1000 }}>
        <Breadcrumb style={{ marginBottom: "16px" }} items={breadcrumbItems} />
        <Switch>
          <Route
            path="/organization/overview"
            render={() => <OrganizationOverviewView organization={organization} />}
          />
          <Route
            path="/organization/notifications"
            render={() => <OrganizationNotificationsView organization={organization} />}
          />
          <Route
            path="/organization/delete"
            render={() => <OrganizationDangerZoneView organization={organization} />}
          />
          <Route path="/organization" render={() => <Redirect to="/organization/overview" />} />
        </Switch>
      </Content>
    </Layout>
  );
};

const mapStateToProps = (state: WebknossosState): Props => ({
  organization: enforceActiveOrganization(state.activeOrganization),
});
export default connect(mapStateToProps)(OrganizationView);
