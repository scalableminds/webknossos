import { CheckOutlined, DownOutlined } from "@ant-design/icons";
import { updateSelectedThemeOfUser } from "admin/rest_api";
import { Col, Dropdown, Row } from "antd";
import { useWkSelector } from "libs/react_hooks";
import * as Utils from "libs/utils";
import { getSystemColorTheme } from "theme";
import type { APIUserTheme } from "types/api_types";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import { setThemeAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/store";
import { SettingsCard } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";

function AccountProfileView() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const { selectedTheme } = activeUser || { selectedTheme: "auto" };

  if (!activeUser) return null;

  const role = Utils.isUserAdmin(activeUser)
    ? "Administrator"
    : Utils.isUserTeamManager(activeUser)
      ? "Team Manager"
      : "User";

  const setSelectedTheme = async (newTheme: APIUserTheme) => {
    if (newTheme === "auto") newTheme = getSystemColorTheme();

    if (selectedTheme !== newTheme) {
      const newUser = await updateSelectedThemeOfUser(activeUser.id, newTheme);
      Store.dispatch(setThemeAction(newTheme));
      Store.dispatch(setActiveUserAction(newUser));
    }
  };

  const themeItems = [
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
  ];

  const profileItems = [
    {
      title: "Name",
      value: formatUserName(activeUser, activeUser),
    },
    {
      title: "Email",
      value: activeUser.email,
    },
    {
      title: "Organization",
      value: activeOrganization?.name || activeUser.organization,
    },
    {
      title: "Role",
      value: role,
      explanation: (
        <a href="https://docs.webknossos.org/webknossos/users/access_rights.html">Learn More</a>
      ),
    },
    {
      title: "Theme",
      value: (
        <Dropdown.Button menu={{ items: themeItems }} trigger={["click"]} icon={<DownOutlined />}>
          {themeItems.find((item) => item.key === selectedTheme)?.label}
        </Dropdown.Button>
      ),
    },
  ];

  return (
    <div>
      <SettingsTitle
        title="Profile"
        description="Manage your personal information and preferences"
      />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        {profileItems.map((item) => (
          <Col span={12} key={item.title}>
            <SettingsCard
              title={item.title}
              description={item.value}
              explanation={item.explanation}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
}

export default AccountProfileView;
