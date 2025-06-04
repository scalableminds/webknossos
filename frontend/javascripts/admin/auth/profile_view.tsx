import { Descriptions, Typography, Dropdown, Divider, Card } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import * as Utils from "libs/utils";
import { CheckOutlined, DownOutlined } from "@ant-design/icons";
import type { APIUserTheme } from "types/api_types";
import { getSystemColorTheme } from "theme";
import { updateSelectedThemeOfUser } from "admin/rest_api";
import Store from "viewer/store";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { setThemeAction } from "viewer/model/actions/ui_actions";

const { Title, Text } = Typography;

function ProfileView() {
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
      label: "Name",
      children: formatUserName(activeUser, activeUser),
    },
    {
      label: "Email",
      children: activeUser.email,
    },
    {
      label: "Organization",
      children: activeOrganization?.name || activeUser.organization,
    },
    {
      label: "Role",
      children: role,
    },
    {
      label: "Theme",
      children: (
        <Dropdown menu={{ items: themeItems }} trigger={["click"]}>
          <Text>
            {themeItems.find((item) => item.key === selectedTheme)?.label} <DownOutlined />
          </Text>
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <Title level={2}>Profile</Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
        Manage your personal information and preferences
      </Text>
      <Divider />
      <Card>
        <Card.Meta title="Profile" description="Manage your personal information and preferences" />
        <Descriptions
          column={2}
          colon={false}
          layout="vertical"
          style={{ marginBottom: 24 }}
          items={profileItems}
        />
      </Card>
    </div>
  );
}

export default ProfileView;
