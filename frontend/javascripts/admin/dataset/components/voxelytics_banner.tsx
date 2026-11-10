import segmentationEmOverlay from "@images/vx/segmentation-em-overlay.webp";
import { Badge, Button, Card, Flex, Typography, theme } from "antd";
import features from "features";
import type { CSSProperties } from "react";
import { ColorWKBlueZircon } from "theme";

const smallCapsStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

// Promotes the AI add-on next to the dataset upload views (webknossos.org only).
export default function VoxelyticsBanner() {
  const { token } = theme.useToken();

  if (!features().isWkorgInstance) {
    return null;
  }

  const cover = (
    <div
      role="img"
      aria-label="Automated segmentation of an EM dataset"
      style={{
        height: 180,
        backgroundImage: `linear-gradient(to bottom, transparent 40%, ${token.colorBgContainer}), url(${segmentationEmOverlay})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );

  return (
    <div className="hide-on-small-screen" style={{ width: 300, flexShrink: 0 }}>
      <Card variant="outlined" cover={cover}>
        <Flex vertical align="flex-start" gap="large">
          <Flex vertical gap="small">
            <Badge
              color={ColorWKBlueZircon}
              text={
                <Typography.Text type="secondary" style={smallCapsStyle}>
                  AI add-on
                </Typography.Text>
              }
            />
            <Typography.Title level={4} style={{ margin: 0, fontWeight: 500 }}>
              Segment and align this dataset yourself.
            </Typography.Title>
            {/* type="secondary" would resolve to the dimmer colorTextTertiary, see theme.ts. */}
            <Typography.Text style={{ color: token.colorTextSecondary }}>
              The AI add-on lets you train segmentation models on your datasets. Fit custom models
              to your data, directly in WEBKNOSSOS.
            </Typography.Text>
          </Flex>
          <Button
            type="primary"
            href="https://webknossos.org/pricing"
            target="_blank"
            rel="noopener noreferrer"
          >
            Explore the AI add-on
          </Button>
          <Typography.Text type="secondary" style={smallCapsStyle}>
            Credit-based · Available to Team &amp; Power Plan
          </Typography.Text>
        </Flex>
      </Card>
    </div>
  );
}
