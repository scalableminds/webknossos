import Icon, { CloseOutlined } from "@ant-design/icons";
import IconAnnotate from "@images/backgrounds/annotate.svg?react";
import IconImportOwnData from "@images/backgrounds/import-own-data.svg?react";
import IconInviteColleagues from "@images/backgrounds/invite-colleagues.svg?react";
import IconOpenDemo from "@images/backgrounds/open-demo.svg?react";
import { InviteUsersModal } from "admin/onboarding";
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  Flex,
  Grid,
  Row,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { getDemoDatasetUrl } from "features";
import renderIndependently from "libs/render_independently";
import { isUserAdminOrDatasetManager, isUserAdminOrTeamManager } from "libs/utils";
import type React from "react";
import { Link } from "react-router";
import { getAntdTheme } from "theme";
import type { APIUser } from "types/api_types";

const ACTION_ICON_SIZE = 96;
const COMPACT_ACTION_ICON_SIZE = 40;
const ACTIONS_MAX_WIDTH = 880;

type WhatsNextActionProps = {
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Icon>["component"];
  onClick?: () => void;
  href?: string;
  to?: string;
};

const ActionLink = ({
  onClick,
  href,
  to,
  children,
}: Pick<WhatsNextActionProps, "onClick" | "href" | "to"> & { children: React.ReactNode }) => {
  const style = { display: "block", height: "100%" };
  if (to != null) {
    return (
      <Link to={to} style={style}>
        {children}
      </Link>
    );
  }
  if (href != null) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={style}>
        {children}
      </a>
    );
  }
  return (
    <a href="#" onClick={onClick} style={style}>
      {children}
    </a>
  );
};

// On narrow screens, `compact` drops the description and shrinks the icon so all actions fit on
// roughly half a screen; the titles alone say what each action does.
const WhatsNextAction = ({
  title,
  description,
  icon,
  compact,
  ...linkProps
}: WhatsNextActionProps & { compact: boolean }) => (
  <ActionLink {...linkProps}>
    <Card hoverable size="small" style={{ height: "100%" }}>
      <Card.Meta
        avatar={
          <Icon
            component={icon}
            style={{ fontSize: compact ? COMPACT_ACTION_ICON_SIZE : ACTION_ICON_SIZE }}
            aria-hidden
          />
        }
        title={title}
        description={compact ? null : description}
        styles={{ root: { alignItems: "center" }, title: { whiteSpace: "normal" } }}
      />
    </Card>
  </ActionLink>
);

const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => {
  const { token } = theme.useToken();
  return (
    <Tooltip title="Don't show this again" placement="left">
      <Button
        type="text"
        onClick={onDismiss}
        icon={<CloseOutlined />}
        iconPlacement="end"
        style={{ color: token.colorTextLightSolid, alignSelf: "flex-end" }}
      >
        Close
      </Button>
    </Tooltip>
  );
};

const openInviteUsersModal = (activeUser: APIUser) =>
  renderIndependently((destroy) => (
    <InviteUsersModal organizationId={activeUser.organization} destroy={destroy} />
  ));

const getWhatsNextActions = (activeUser: APIUser): WhatsNextActionProps[] => [
  {
    title: "Open a Demo Dataset",
    description: "Have a look at a public dataset to experience WEBKNOSSOS in action.",
    href: getDemoDatasetUrl(),
    icon: IconOpenDemo,
  },
  ...(isUserAdminOrDatasetManager(activeUser)
    ? [
        {
          title: "Import Your Own Data",
          description: "Directly upload your data as a zip file.",
          to: "/datasets/upload",
          icon: IconImportOwnData,
        },
      ]
    : []),
  {
    title: "Learn How To Create Annotations",
    description: "Watch a short video to see how data can be annotated with WEBKNOSSOS.",
    href: "https://www.youtube.com/watch?v=iw2C7XB6wP4",
    icon: IconAnnotate,
  },
  ...(isUserAdminOrTeamManager(activeUser)
    ? [
        {
          title: "Invite Your Colleagues",
          description:
            "Send email invites to your colleagues and ask them to join your organization.",
          onClick: () => openInviteUsersModal(activeUser),
          icon: IconInviteColleagues,
        },
      ]
    : []),
];

type WhatsNextHeaderProps = {
  activeUser: APIUser;
  onDismiss: () => void;
};

export const WhatsNextHeader = ({ activeUser, onDismiss }: WhatsNextHeaderProps) => {
  const { token } = theme.useToken();
  const actions = getWhatsNextActions(activeUser);
  // Below md the actions stack in a single column, so switch to the compact variant there.
  // Treat "breakpoints not measured yet" as wide, so the first render never flashes the compact layout.
  const isNarrow = Grid.useBreakpoint().md === false;
  const onBlueTextStyle = { color: token.colorTextLightSolid, textAlign: "center" as const };
  const gutter = isNarrow ? token.marginSM : token.marginLG;

  return (
    <Flex
      vertical
      className="welcome-header"
      style={{ padding: token.paddingXS, paddingBottom: token.paddingXL }}
    >
      <DismissButton onDismiss={onDismiss} />
      <Flex vertical align="center" style={{ paddingInline: token.padding }}>
        <Typography.Title
          level={isNarrow ? 3 : 1}
          style={{ ...onBlueTextStyle, marginTop: 0, fontWeight: 200 }}
        >
          Welcome to WEBKNOSSOS
        </Typography.Title>
        {isNarrow ? null : (
          <Typography.Paragraph
            style={{
              ...onBlueTextStyle,
              fontSize: token.fontSizeLG,
              fontWeight: 300,
              maxWidth: 700,
            }}
          >
            Congratulations on your new WEBKNOSSOS account! To hit the ground running, we recommend
            the following steps to you:
          </Typography.Paragraph>
        )}
        {/* The cards stay light in dark mode, too, so they read well on the blue background. */}
        <ConfigProvider theme={getAntdTheme("light")}>
          <Row
            gutter={[gutter, gutter]}
            justify="center"
            style={{ width: "100%", maxWidth: ACTIONS_MAX_WIDTH }}
          >
            {actions.map((action) => (
              <Col key={action.title} xs={24} md={12}>
                <WhatsNextAction {...action} compact={isNarrow} />
              </Col>
            ))}
          </Row>
        </ConfigProvider>
      </Flex>
    </Flex>
  );
};
