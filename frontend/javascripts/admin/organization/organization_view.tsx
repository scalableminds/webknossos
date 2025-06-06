import { DeleteOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { Breadcrumb, Layout, Menu } from "antd";
import { connect } from "react-redux";
import { Route, useHistory, useLocation, Switch } from "react-router-dom";
import type { APIOrganization } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import type { WebknossosState } from "viewer/store";
import { OrganizationDangerZoneView } from "./organization_dangerzone_view";
import { OrganizationProfileView } from "./organization_profile";
import { OrganizationNotificationsView } from "./organization_settings";
import type { MenuItemGroupType } from "antd/es/menu/interface";
import { Redirect } from "react-router-dom";

const { Sider, Content } = Layout;

type Props = {
  organization: APIOrganization;
};

const BREADCRUMB_LABELS = {
  profile: "Profile",
  settings: "Settings",
  delete: "Delete",
};

const OrganizationView = ({ organization }: Props) => {
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").pop() || "profile";

  const menuItems: MenuItemGroupType[] = [
    {
      label: "Organization",
      type: "group",
      children: [
        {
          key: "profile",
          icon: <UserOutlined />,
          label: "Profile",
        },
        {
          key: "settings",
          icon: <SettingOutlined />,
          label: "Settings",
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
      <Content style={{ padding: "24px", minHeight: 280, maxWidth: 1000 }}>
        <Breadcrumb style={{ marginBottom: "16px", padding: "8px 0" }} items={breadcrumbItems} />
        <Switch>
          <Route
            path="/organization/profile"
            render={() => <OrganizationProfileView organization={organization} />}
          />
          <Route
            path="/organization/settings"
            render={() => <OrganizationNotificationsView organization={organization} />}
          />
          <Route
            path="/organization/delete"
            render={() => <OrganizationDangerZoneView organization={organization} />}
          />
          <Route path="/organization" render={() => <Redirect to="/organization/profile" />} />
        </Switch>
      </Content>
    </Layout>
  );
};

const mapStateToProps = (state: WebknossosState): Props => ({
  organization: enforceActiveOrganization(state.activeOrganization),
});
export default connect(mapStateToProps)(OrganizationView);
