import { Badge, Button, Card, Flex, Typography, theme } from "antd";
import type { CSSProperties } from "react";
import { ColorWKBlueZircon } from "theme";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  footnote?: string;
  coverImage: { src: string; alt: string };
  // Drops the card chrome and shrinks the cover, to nest the ad inside another card.
  embedded?: boolean;
};

export const smallCapsStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

function AdCover({ src, alt, embedded }: { src: string; alt: string; embedded: boolean }) {
  const { token } = theme.useToken();
  return (
    <div
      role="img"
      aria-label={alt}
      style={{
        height: embedded ? 120 : 180,
        borderRadius: embedded ? token.borderRadiusLG : undefined,
        backgroundImage: `linear-gradient(to bottom, transparent 40%, ${token.colorBgContainer}), url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}

// A promotional card for WEBKNOSSOS add-ons and services.
export default function AdCard({
  eyebrow,
  title,
  description,
  ctaLabel,
  ctaHref,
  footnote,
  coverImage,
  embedded = false,
}: Props) {
  const { token } = theme.useToken();
  const cover = <AdCover {...coverImage} embedded={embedded} />;

  const content = (
    <Flex vertical align="flex-start" gap={embedded ? "middle" : "large"}>
      <Flex vertical gap="small">
        <Badge
          color={ColorWKBlueZircon}
          text={
            <Typography.Text type="secondary" style={smallCapsStyle}>
              {eyebrow}
            </Typography.Text>
          }
        />
        <Typography.Title level={embedded ? 5 : 4} style={{ margin: 0, fontWeight: 500 }}>
          {title}
        </Typography.Title>
        {/* type="secondary" would resolve to the dimmer colorTextTertiary, see theme.ts. */}
        <Typography.Text style={{ color: token.colorTextSecondary }}>{description}</Typography.Text>
      </Flex>
      <Button
        type={embedded ? "default" : "primary"}
        href={ctaHref}
        target="_blank"
        rel="noopener noreferrer"
      >
        {ctaLabel}
      </Button>
      {footnote != null ? (
        <Typography.Text type="secondary" style={smallCapsStyle}>
          {footnote}
        </Typography.Text>
      ) : null}
    </Flex>
  );

  if (embedded) {
    return (
      <Flex vertical gap="middle">
        {cover}
        {content}
      </Flex>
    );
  }
  return (
    <Card variant="borderless" cover={cover}>
      {content}
    </Card>
  );
}
