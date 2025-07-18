import { SafetyOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { Breadcrumb, Layout, Menu } from "antd";
import type { MenuItemGroupType } from "antd/es/menu/interface";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

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
  const navigate = useNavigate();
  const selectedKey = location.pathname.split("/").filter(Boolean).pop() || "profile";

  const breadcrumbItems = [
    {
      title: "Account Settings",
    },
    {
      title: BREADCRUMB_LABELS[selectedKey as keyof typeof BREADCRUMB_LABELS],
    },
  ];

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
          onClick={({ key }) => navigate(`/account/${key}`)}
        />
      </Sider>
      <Content style={{ padding: "32px", minHeight: 280, maxWidth: 1000 }}>
        <Breadcrumb style={{ marginBottom: "16px" }} items={breadcrumbItems} />
        <Outlet />
      </Content>
    </Layout>
  );
}

export default AccountSettingsView;
