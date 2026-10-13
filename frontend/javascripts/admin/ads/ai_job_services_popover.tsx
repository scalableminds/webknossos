import { DownOutlined } from "@ant-design/icons";
import { Badge, Button, Flex, Popover, Typography, theme } from "antd";
import features from "features";
import { useState } from "react";
import { ColorWKBlueZircon } from "theme";

type Service = {
  eyebrow: string;
  description: string;
  linkLabel: string;
  href: string;
};

const SERVICES: Service[] = [
  {
    eyebrow: "Custom model training",
    description:
      "Our team generates training data and trains a custom model for data the pre-trained models cannot handle.",
    linkLabel: "See segmentation services →",
    href: "https://home.webknossos.org/services/automated-segmentation",
  },
  {
    eyebrow: "Alignment",
    description:
      "For big multi-SEM and multi-tile datasets, our team runs alignment and stitching for you.",
    linkLabel: "See our alignment services →",
    href: "https://webknossos.org/services/alignment",
  },
];

const POPOVER_WIDTH = 360;

function Eyebrow({ children }: { children: string }) {
  const { token } = theme.useToken();
  return (
    <Badge
      color={ColorWKBlueZircon}
      text={
        <span
          style={{
            fontFamily: token.fontFamilyCode,
            fontSize: token.fontSizeSM,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            // Mixing the cyan accent into the text color keeps it legible in light and dark mode.
            color: `color-mix(in srgb, ${ColorWKBlueZircon} 40%, ${token.colorText})`,
          }}
        >
          {children}
        </span>
      }
    />
  );
}

function ServiceEntry({ eyebrow, description, linkLabel, href }: Service) {
  const { token } = theme.useToken();
  const [isHovered, setIsHovered] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: token.marginXXS,
        padding: `${token.paddingSM}px ${token.paddingLG}px`,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        background: isHovered ? token.colorFillQuaternary : undefined,
        transition: `background ${token.motionDurationFast}`,
      }}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <span style={{ color: token.colorTextSecondary }}>{description}</span>
      <span style={{ color: isHovered ? token.colorLinkHover : token.colorLink }}>{linkLabel}</span>
    </a>
  );
}

function AiJobServicesContent() {
  const { token } = theme.useToken();
  return (
    <Flex vertical style={{ width: POPOVER_WIDTH }}>
      <Flex vertical gap={token.marginXXS} style={{ padding: token.paddingLG }}>
        <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
          Our team can take this on
        </Typography.Text>
        <Typography.Text style={{ color: token.colorTextSecondary }}>
          For data the self-service jobs cannot handle.
        </Typography.Text>
      </Flex>
      {SERVICES.map((service) => (
        <ServiceEntry key={service.eyebrow} {...service} />
      ))}
    </Flex>
  );
}

// Points to the WEBKNOSSOS team's services from the AI job drawer (webknossos.org only).
export default function AiJobServicesPopover() {
  const [isOpen, setIsOpen] = useState(false);

  if (!features().isWkorgInstance) {
    return null;
  }
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={isOpen}
      onOpenChange={setIsOpen}
      content={<AiJobServicesContent />}
      styles={{ container: { padding: 0, overflow: "hidden" } }}
    >
      <Button
        iconPlacement="end"
        icon={
          <DownOutlined
            style={{
              fontSize: 10,
              transform: isOpen ? "rotate(180deg)" : undefined,
              transition: "transform 0.2s",
            }}
          />
        }
      >
        Need help with your data?
      </Button>
    </Popover>
  );
}
