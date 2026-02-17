import { CheckOutlined, DownOutlined, EditOutlined } from "@ant-design/icons";
import ChangeEmailView from "admin/auth/change_email_view";
import ChangeUsernameView from "admin/auth/change_username_view";
import { updateSelectedThemeOfUser } from "admin/rest_api";
import { Button, Col, Dropdown, Row, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";

import { isUserAdmin, isUserTeamManager } from "libs/utils";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { getSystemColorTheme } from "theme";
import type { APIUserTheme } from "types/api_types";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import { setThemeAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { SettingsCard, type SettingsCardProps } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";

function AccountProfileView() {
  const dispatch = useDispatch();

  const activeUser = useWkSelector((state) => state.activeUser);
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const { selectedTheme } = activeUser || { selectedTheme: "auto" };
  const [isChangeEmailVisible, setChangeEmailVisible] = useState(false);
  const [isChangeNameVisible, setChangeNameViewVisible] = useState(false);
  if (!activeUser) return null;

  const role = isUserAdmin(activeUser)
    ? "Administrator"
    : isUserTeamManager(activeUser)
      ? "Team Manager"
      : "User";

  const setSelectedTheme = async (newTheme: APIUserTheme) => {
    if (selectedTheme !== newTheme) {
      const newUser = await updateSelectedThemeOfUser(activeUser.id, newTheme);
      dispatch(setActiveUserAction(newUser));

      dispatch(setThemeAction(newTheme === "auto" ? getSystemColorTheme() : newTheme));
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

  const profileItems: SettingsCardProps[] = [
    {
      title: "Name",
      content: isChangeNameVisible ? (
        <ChangeUsernameView
          user={activeUser}
          onClose={() => setChangeNameViewVisible(false)}
          setEditedUser={(updatedUser) => dispatch(setActiveUserAction(updatedUser))}
        />
      ) : (
        formatUserName(activeUser, activeUser)
      ),
      action: (
        <Button
          type="default"
          shape="circle"
          icon={<EditOutlined />}
          size="small"
          onClick={() => setChangeNameViewVisible(!isChangeNameVisible)}
        />
      ),
    },
    {
      title: "Email",
      content: isChangeEmailVisible ? (
        <ChangeEmailView onCancel={() => setChangeEmailVisible(false)} />
      ) : (
        activeUser.email
      ),
      action: (
        <Button
          type="default"
          shape="circle"
          icon={<EditOutlined />}
          size="small"
          onClick={() => setChangeEmailVisible(!isChangeEmailVisible)}
        />
      ),
    },
    {
      title: "Organization",
      content: activeOrganization?.name || activeUser.organization,
    },
    {
      title: "Role",
      content: role,
      tooltip: (
        <a href="https://docs.webknossos.org/webknossos/users/access_rights.html">Learn More</a>
      ),
    },
    {
      title: "Theme",
      content: (
        <Space.Compact>
          <Button>{themeItems.find((item) => item.key === selectedTheme)?.label}</Button>
          <Dropdown menu={{ items: themeItems }} trigger={["click"]}>
            <Button icon={<DownOutlined />} aria-label="Select theme" />
          </Dropdown>
        </Space.Compact>
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
              content={item.content}
              tooltip={item.tooltip}
              action={item.action}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
}

export default AccountProfileView;
