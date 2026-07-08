import drawingWavingPerson from "@images/backgrounds/waving-person.svg";
import WKLogoIcon from "@images/wk-logo.svg?react";
import { Button, ConfigProvider, Flex, notification, Space, Typography } from "antd";
import type { NotificationInstance } from "antd/es/notification/interface";
import features from "features";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import UserLocalStorage from "libs/user_local_storage";
import defaultsDeep from "lodash-es/defaultsDeep";
import { getAntdTheme } from "theme";

// White buttons with blue text/border to stand out against the wk-blue background.
const darkThemeWithWhiteButtons = defaultsDeep(
  {
    components: {
      Button: {
        colorPrimary: "#ffffff",
        colorPrimaryHover: "#e6e6e6",
        colorPrimaryActive: "#d9d9d9",
        primaryColor: "var(--color-wk-blue)",
      },
    },
  },
  getAntdTheme("dark"),
);

function showWelcomeToast(notification: NotificationInstance) {
  notification.open({
    duration: 0,
    placement: "bottomRight",
    title: (
      <Flex justify="space-between" align="flex-start" gap="middle">
        <Typography.Title level={4}>Welcome to WEBKNOSSOS</Typography.Title>
        <WKLogoIcon
          width={64}
          height={64}
          style={{
            filter: "brightness(4)",
            flexShrink: 0,
          }}
        />
      </Flex>
    ),
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
              src={drawingWavingPerson}
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
              Learn more
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
  return <ConfigProvider theme={darkThemeWithWhiteButtons}>{contextHolder}</ConfigProvider>;
}
