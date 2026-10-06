import {
  BankOutlined,
  DeleteOutlined,
  HistoryOutlined,
  MailOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Breadcrumb, Flex, Layout, Menu } from "antd";
import type { MenuItemGroupType } from "antd/es/menu/interface";
import { Outlet, useLocation, useNavigate } from "react-router";
import constants from "viewer/constants";
import { OrganizationSidebarUpsell } from "./organization_sidebar_upsell";

const { Sider, Content } = Layout;

const BREADCRUMB_LABELS = {
  overview: "Overview",
  notifications: "Notification Settings",
  "credit-activity": "Credit Activity",
  planupdates: "Plan Updates",
  delete: "Delete Organization",
};

const MENU_ITEMS: MenuItemGroupType[] = [
  {
    label: "Organization",
    type: "group",
    children: [
      {
        key: "overview",
        icon: <UserOutlined />,
        label: "Overview",
      },
      {
        key: "notifications",
        icon: <MailOutlined />,
        label: "Notifications",
      },
      {
        key: "delete",
        icon: <DeleteOutlined />,
        label: "Delete",
      },
    ],
  },
  {
    label: "Activity Logs",
    type: "group",
    children: [
      {
        key: "planupdates",
        icon: <HistoryOutlined />,
        label: "Plan Updates",
      },
      {
        key: "credit-activity",
        icon: <BankOutlined />,
        label: "Credit Activity",
      },
    ],
  },
];

const OrganizationView = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey =
    location.pathname
      .split("/")
      .filter((p) => p.length > 0)
      .pop() || "overview";

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
        minHeight: `calc(100vh - ${constants.DEFAULT_NAVBAR_HEIGHT}px)`,
        backgroundColor: "var(--ant-layout-body-bg)",
      }}
    >
      <Sider
        width={250}
        style={{
          background: "var(--ant-color-bg-container)",
          borderInlineEnd: "1px solid var(--ant-color-split)",
        }}
      >
        <Flex
          vertical
          style={{
            // Keeps the upsell card at the bottom of the viewport on long pages.
            position: "sticky",
            top: constants.DEFAULT_NAVBAR_HEIGHT,
            height: `calc(100vh - ${constants.DEFAULT_NAVBAR_HEIGHT}px)`,
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ padding: 24, borderInlineEnd: "none" }}
            items={MENU_ITEMS}
            onClick={({ key }) => navigate(`/organization/${key}`)}
          />
          <div style={{ marginTop: "auto", padding: "0 24px 24px" }}>
            <OrganizationSidebarUpsell />
          </div>
        </Flex>
      </Sider>
      <Content style={{ padding: "32px", minHeight: 280, maxWidth: 1200 }}>
        <Breadcrumb style={{ marginBottom: "16px" }} items={breadcrumbItems} />
        <Outlet />
      </Content>
    </Layout>
  );
};

export default OrganizationView;
