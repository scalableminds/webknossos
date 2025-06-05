import { SafetyOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { Layout, Menu } from "antd";
import { Route, Switch, useHistory, useLocation } from "react-router-dom";
import AuthTokenView from "./auth_token_view";
import ChangePasswordView from "./change_password_view";
import ProfileView from "./profile_view";

const { Sider, Content } = Layout;

function AccountSettingsView() {
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").pop() || "profile";

  const menuItems = [
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
            <Route path="/account/token" component={AuthTokenView} />
            <Route path="/account" component={ProfileView} />
          </Switch>
        </Content>
      </Layout>
    </Layout>
  );
}

export default AccountSettingsView;
