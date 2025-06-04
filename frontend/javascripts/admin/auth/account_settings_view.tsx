import { Layout, Menu } from "antd";
import { Route, Switch, useLocation, useHistory } from "react-router-dom";
import {
  CheckOutlined,
  LockOutlined,
  MailOutlined,
  SafetyOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import ChangePasswordView from "./change_password_view";
import AuthTokenView from "./auth_token_view";
import { useWkSelector } from "libs/react_hooks";
import type { APIUserTheme } from "types/api_types";
import { getSystemColorTheme } from "theme";
import { updateSelectedThemeOfUser } from "admin/rest_api";
import Store from "viewer/store";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { setThemeAction } from "viewer/model/actions/ui_actions";

const { Sider, Content } = Layout;

function EmailSettings() {
  return (
    <div>
      <h2>Email Settings</h2>
      <p>Email settings page content will be added here.</p>
    </div>
  );
}

function PasskeysSettings() {
  return (
    <div>
      <h2>Passkeys</h2>
      <p>Passkeys settings page content will be added here.</p>
    </div>
  );
}

function AppearanceSettings() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const { selectedTheme } = activeUser || { selectedTheme: "auto" };

  const setSelectedTheme = async (newTheme: APIUserTheme) => {
    if (!activeUser) return;

    if (newTheme === "auto") newTheme = getSystemColorTheme();

    if (selectedTheme !== newTheme) {
      const newUser = await updateSelectedThemeOfUser(activeUser.id, newTheme);
      Store.dispatch(setThemeAction(newTheme));
      Store.dispatch(setActiveUserAction(newUser));
    }
  };

  return (
    <div>
      <h2>Appearance</h2>
      <div style={{ marginTop: 16 }}>
        <h3>Theme</h3>
        <Menu
          mode="inline"
          selectedKeys={[selectedTheme]}
          items={[
            {
              key: "auto",
              label: "System Default",
              icon: selectedTheme === "auto" ? <CheckOutlined /> : null,
              onClick: () => setSelectedTheme("auto"),
            },
            {
              key: "light",
              label: "Light",
              icon: selectedTheme === "light" ? <CheckOutlined /> : null,
              onClick: () => setSelectedTheme("light"),
            },
            {
              key: "dark",
              label: "Dark",
              icon: selectedTheme === "dark" ? <CheckOutlined /> : null,
              onClick: () => setSelectedTheme("dark"),
            },
          ]}
        />
      </div>
    </div>
  );
}

function AccountSettingsView() {
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").pop() || "email";

  const menuItems = [
    {
      key: "email",
      icon: <MailOutlined />,
      label: "Email",
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
    {
      key: "appearance",
      icon: <SettingOutlined />,
      label: "Appearance",
    },
  ];

  return (
    <Layout style={{ minHeight: "calc(100vh - 64px)" }}>
      <Sider width={200} theme="light">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ height: "100%" }}
          items={menuItems}
          onClick={({ key }) => history.push(`/account/${key}`)}
        />
      </Sider>
      <Content style={{ padding: "24px", minHeight: 280 }}>
        <Switch>
          <Route path="/account/email" component={EmailSettings} />
          <Route path="/account/password" component={ChangePasswordView} />
          <Route path="/account/passkeys" component={PasskeysSettings} />
          <Route path="/account/token" component={AuthTokenView} />
          <Route path="/account/appearance" component={AppearanceSettings} />
          <Route path="/account" component={EmailSettings} />
        </Switch>
      </Content>
    </Layout>
  );
}

export default AccountSettingsView;
