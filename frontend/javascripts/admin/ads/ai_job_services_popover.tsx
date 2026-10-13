import { DownOutlined } from "@ant-design/icons";
import { smallCapsStyle } from "admin/ads/ad_card";
import { Badge, Button, Divider, Flex, Popover, Typography, theme } from "antd";
import features from "features";
import { Fragment } from "react";

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

function ServiceEntry({ eyebrow, description, linkLabel, href }: Service) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={4}>
      <Typography.Text type="secondary" style={smallCapsStyle}>
        {eyebrow}
      </Typography.Text>
      {/* type="secondary" would resolve to the dimmer colorTextTertiary, see theme.ts. */}
      <Typography.Text style={{ color: token.colorTextSecondary }}>{description}</Typography.Text>
      <Typography.Link href={href} target="_blank" rel="noopener noreferrer">
        {linkLabel}
      </Typography.Link>
    </Flex>
  );
}

function AiJobServicesContent() {
  const { token } = theme.useToken();
  return (
    <Flex vertical style={{ width: 380 }}>
      <Typography.Text style={{ color: token.colorTextSecondary }}>
        For data the self-service jobs cannot handle.
      </Typography.Text>
      {SERVICES.map((service) => (
        <Fragment key={service.eyebrow}>
          <Divider style={{ margin: `${token.marginSM}px 0` }} />
          <ServiceEntry {...service} />
        </Fragment>
      ))}
    </Flex>
  );
}

// Points to the WEBKNOSSOS team's services from the AI job drawer (webknossos.org only).
export default function AiJobServicesPopover() {
  if (!features().isWkorgInstance) {
    return null;
  }
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Our team can take this on"
      content={<AiJobServicesContent />}
    >
      <Button size="small" icon={<DownOutlined />} iconPlacement="end">
        <Badge status="success" text="Need help with your data?" />
      </Button>
    </Popover>
  );
}
