import { Layout, Menu } from "antd";
import { Route, Switch, useLocation, useHistory } from "react-router-dom";
import { LockOutlined, SafetyOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import ChangePasswordView from "./change_password_view";
import AuthTokenView from "./auth_token_view";
import ProfileView from "./profile_view";

const { Sider, Content } = Layout;

function PasskeysSettings() {
  return (
    <div>
      <h2>Passkeys</h2>
      <p>Passkeys settings page content will be added here.</p>
    </div>
  );
}

function AccountSettingsView() {
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").pop() || "profile";

  const menuItems = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "Profile",
    },
    {
      key: "password",
      icon: <LockOutlined />,
      label: "Password",
    },
    {
      key: "passkeys",
      icon: <SafetyOutlined />,
      label: "Passkeys",
    },
    {
      key: "token",
      icon: <SettingOutlined />,
      label: "Auth Token",
    },
  ];

  return (
    <Layout style={{ minHeight: "calc(100vh - 64px)" }} className="container">
      <h1>Account Settings</h1>
      <Layout>
        <Sider width={200}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ height: "100%" }}
            items={menuItems}
            onClick={({ key }) => history.push(`/account/${key}`)}
          />
        </Sider>
        <Content style={{ padding: "24px", paddingTop: 0, minHeight: 280 }}>
          <Switch>
            <Route path="/account/profile" component={ProfileView} />
            <Route path="/account/password" component={ChangePasswordView} />
            <Route path="/account/passkeys" component={PasskeysSettings} />
            <Route path="/account/token" component={AuthTokenView} />
            <Route path="/account" component={ProfileView} />
          </Switch>
        </Content>
      </Layout>
    </Layout>
  );
}

export default AccountSettingsView;
