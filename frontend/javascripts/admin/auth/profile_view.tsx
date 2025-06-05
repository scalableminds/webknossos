import { CheckOutlined, DownOutlined } from "@ant-design/icons";
import { updateSelectedThemeOfUser } from "admin/rest_api";
import { Descriptions, Divider, Dropdown, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import * as Utils from "libs/utils";
import { getSystemColorTheme } from "theme";
import type { APIUserTheme } from "types/api_types";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import { setThemeAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/store";

const { Text } = Typography;

export function AccountSettingsTitle({
  title,
  description,
}: { title: string; description: string }) {
  return (
    <div>
      <h2 style={{ marginBottom: 0 }}>{title}</h2>
      <Text type="secondary" style={{ display: "block" }}>
        {description}
      </Text>
      <Divider style={{ margin: "12px 0 32px 0" }} />
    </div>
  );
}

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
        <Dropdown.Button menu={{ items: themeItems }} trigger={["click"]} icon={<DownOutlined />}>
          {themeItems.find((item) => item.key === selectedTheme)?.label}
        </Dropdown.Button>
      ),
    },
  ];

  return (
    <div>
      <AccountSettingsTitle
        title="Profile"
        description="Manage your personal information and preferences"
      />
      <Descriptions
        column={2}
        colon={false}
        layout="vertical"
        style={{ marginBottom: 24 }}
        items={profileItems}
      />
    </div>
  );
}

export default ProfileView;
