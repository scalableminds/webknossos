import { SafetyOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { Breadcrumb, Layout, Menu } from "antd";
import type { MenuItemGroupType } from "antd/es/menu/interface";
import { Redirect, Route, Switch, useHistory, useLocation } from "react-router-dom";
import AccountAuthTokenView from "./account_auth_token_view";
import AccountPasswordView from "./account_password_view";
import AccountProfileView from "./account_profile_view";

const { Sider, Content } = Layout;

const BREADCRUMB_LABELS = {
  token: "Auth Token",
  password: "Password",
  profile: "Profile",
};

const MENU_ITEMS: MenuItemGroupType[] = [
  {
    label: "Account",
    type: "group",
    children: [
      {
        key: "profile",
        icon: <UserOutlined />,
        label: "Profile",
      },
      {
        key: "password",
        icon: <SafetyOutlined />,
        label: "Password",
      },
    ],
  },
  {
    label: "Developer",
    type: "group",
    children: [
      {
        key: "token",
        icon: <SettingOutlined />,
        label: "Auth Token",
      },
    ],
  },
];

function AccountSettingsView() {
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").pop() || "profile";

  return (
    <Layout
      style={{ minHeight: "calc(100vh - 64px)", backgroundColor: "var(--ant-layout-body-bg)" }}
    >
      <Sider width={200}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ height: "100%", padding: 24 }}
          items={MENU_ITEMS}
          onClick={({ key }) => history.push(`/account/${key}`)}
        />
      </Sider>
      <Content style={{ padding: "32px", minHeight: 280, maxWidth: 1000 }}>
        <Breadcrumb style={{ marginBottom: "16px" }}>
          <Breadcrumb.Item>Account Settings</Breadcrumb.Item>
          <Breadcrumb.Item>
            {BREADCRUMB_LABELS[selectedKey as keyof typeof BREADCRUMB_LABELS]}
          </Breadcrumb.Item>
        </Breadcrumb>
        <Switch>
          <Route path="/account/profile" component={AccountProfileView} />
          <Route path="/account/password" component={AccountPasswordView} />
          <Route path="/account/token" component={AccountAuthTokenView} />
          <Route path="/account" render={() => <Redirect to="/account/profile" />} />
        </Switch>
      </Content>
    </Layout>
  );
}

export default AccountSettingsView;
