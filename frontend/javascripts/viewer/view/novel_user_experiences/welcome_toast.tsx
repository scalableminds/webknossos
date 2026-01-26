import { Button, ConfigProvider, Flex, Space, Typography, notification } from "antd";
import type { NotificationInstance } from "antd/es/notification/interface";
import features from "features";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import UserLocalStorage from "libs/user_local_storage";
import defaultsDeep from "lodash-es/defaultsDeep";
import { ColorWKBlueZircon, getAntdTheme } from "theme";

const darkThemeWithCyanButton = defaultsDeep(
  { token: { colorPrimary: ColorWKBlueZircon } },
  getAntdTheme("dark"),
);

function showWelcomeToast(notification: NotificationInstance) {
  notification.open({
    className: "webknossos-welcome-toast",
    duration: 0,
    placement: "bottomRight",
    icon: (
      <img
        src="/assets/images/logo-icon-only.svg"
        alt="logo"
        style={{
          filter: "brightness(4)",
          width: 45,
          height: 45,
        }}
      />
    ),
    title: <Typography.Title level={4}>Welcome to WEBKNOSSOS!</Typography.Title>,
    description: (
      <Space orientation="vertical" size="middle">
        <Typography.Paragraph>
          WEBKNOSSOS is a web-based platform for visualization, annotation, and sharing of
          large-scale 3D image datasets.
        </Typography.Paragraph>
        <Typography.Paragraph style={{ width: "90%" }}>
          Try out the annotation features and upload your own data with a free account.
        </Typography.Paragraph>
        <Flex gap="middle">
          <Button
            type="primary"
            href="/auth/signup"
            target="_blank"
            rel="noopener noreferrer"
            block
          >
            Create a free account
          </Button>
          <span style={{ position: "relative" }}>
            <img
              src="/assets/images/drawings/waving-person.svg"
              alt="waving person"
              style={{
                height: 100,
                position: "absolute",
                top: 4,
                right: 0,
                transform: "translate(15%, -104%)",
                pointerEvents: "none",
              }}
            />
            <Button
              href="https://webknossos.org/features"
              target="_blank"
              rel="noopener noreferrer"
              type="primary"
              ghost
            >
              Learn More
            </Button>
          </span>
        </Flex>
      </Space>
    ),
    styles: {
      root: {
        padding: 34,
        backgroundColor: "var(--color-wk-blue)",
      },
      description: {
        marginInlineStart: 0,
      },
      title: {
        paddingLeft: 30, // offset for icon
        marginBottom: 20,
        color: "white",
      },
    },
  });
}

export default function WelcomeToast() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const [api, contextHolder] = notification.useNotification();

  useEffectOnlyOnce(() => {
    if (!features().isWkorgInstance) {
      return;
    }
    const hasSeenToast = UserLocalStorage.getItem(
      "novelUserExperienceInfos.hasSeenWelcomeToast",
      false,
    );

    if (activeUser == null && hasSeenToast == null) {
      // Only if the user is not logged in and has never seen the toast before, we show it here.
      showWelcomeToast(api);
    }

    // Even if the toast wasn't opened above, we set the hasSeen bit, since the decision to not
    // show the toast will still be valid (and important) in the future. For example, the toast
    // should also *not* appear after a registered user logs out.
    UserLocalStorage.setItem("novelUserExperienceInfos.hasSeenWelcomeToast", "true", false);
  });
  return <ConfigProvider theme={darkThemeWithCyanButton}>{contextHolder}</ConfigProvider>;
}
