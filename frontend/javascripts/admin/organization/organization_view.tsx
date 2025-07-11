import { DeleteOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { Breadcrumb, Layout, Menu } from "antd";
import type { MenuItemGroupType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { Route, Switch, useHistory, useLocation } from "react-router-dom";
import { Redirect } from "react-router-dom";
import constants from "viewer/constants";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { OrganizationDangerZoneView } from "./organization_danger_zone_view";
import { OrganizationNotificationsView } from "./organization_notifications_view";
import { OrganizationOverviewView } from "./organization_overview_view";

const { Sider, Content } = Layout;

const BREADCRUMB_LABELS = {
  overview: "Overview",
  notifications: "Notification Settings",
  delete: "Delete Organization",
};

const MENU_ITEMS: MenuItemGroupType[] = [
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

const OrganizationView = () => {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").filter(Boolean).pop() || "overview";

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
        minHeight: `calc(100vh - ${constants.DEFAULT_NAVBAR_HEIGHT}px)`,
        backgroundColor: "var(--ant-layout-body-bg)",
      }}
    >
      <Sider width={200}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ height: "100%", padding: 24 }}
          items={MENU_ITEMS}
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

export default OrganizationView;
