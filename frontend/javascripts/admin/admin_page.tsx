import { InfoCircleOutlined } from "@ant-design/icons";
import { Flex, Grid, Space, Tooltip, Typography, theme } from "antd";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";

function renderSearch(search: ReactNode, isCompact: boolean) {
  if (!isValidElement(search)) {
    return search;
  }
  const searchElement = search as ReactElement<{ style?: CSSProperties }>;
  const existingStyle = searchElement.props.style || {};
  return cloneElement(searchElement, {
    style: {
      ...existingStyle,
      width: existingStyle.width ?? (isCompact ? "100%" : 240),
      maxWidth: existingStyle.maxWidth ?? (isCompact ? 300 : undefined),
    },
  });
}

type Props = {
  title: ReactNode;
  description?: ReactNode;
  descriptionURI?: string;
  actions?: ReactNode;
  search?: ReactNode;
  alerts?: ReactNode;
  filters?: ReactNode;
  subNavigation?: ReactNode;
  contentMaxWidth?: number | string;
  children: ReactNode;
};

export default function AdminPage({
  title,
  description,
  descriptionURI,
  actions,
  search,
  alerts,
  filters,
  subNavigation,
  contentMaxWidth,
  children,
}: Props) {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.md;
  const searchNode = renderSearch(search, isCompact);

  return (
    <div
      style={{
        padding: token.paddingXL,
        background: token.colorBgLayout,
        minHeight: "calc(100vh - var(--navbar-height))",
      }}
    >
      <Space vertical size="large" style={{ width: "100%" }}>
        <div>
          <Flex justify="space-between" align="flex-start" wrap gap="middle">
            <div style={{ maxWidth: "min(100ch, 100%)" }}>
              <Typography.Title
                level={2}
                style={{
                  margin: 0,
                  textTransform: "uppercase",
                }}
              >
                {title}
              </Typography.Title>
              {description != null ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ margin: `${token.marginXXS}px 0 0` }}
                >
                  {description}
                  {descriptionURI != null ? (
                    <a
                      href={descriptionURI}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginInlineStart: token.marginXS,
                      }}
                    >
                      <Tooltip title="Read more in the documentation">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </a>
                  ) : null}
                </Typography.Paragraph>
              ) : null}
            </div>
            {actions != null || searchNode != null ? (
              <Space
                wrap
                size="middle"
                style={{
                  marginLeft: isCompact ? 0 : "auto",
                  justifyContent: isCompact ? "flex-start" : "flex-end",
                  width: isCompact ? "100%" : undefined,
                }}
              >
                {actions}
                {searchNode}
              </Space>
            ) : null}
          </Flex>
        </div>
        {alerts != null ? (
          <Flex vertical gap="small">
            {alerts}
          </Flex>
        ) : null}
        {filters != null ? filters : null}
        <div
          style={{
            border: `1px solid ${token.colorBorder}`,
            borderRadius: token.borderRadius,
            boxShadow: token.boxShadow,
            overflow: "hidden",
            background: token.colorBgContainer,
          }}
        >
          {subNavigation != null ? (
            <div
              style={{
                padding: `${token.paddingSM}px ${token.paddingLG}px 0`,
                background: token.colorBgContainer,
              }}
            >
              {subNavigation}
            </div>
          ) : null}
          {contentMaxWidth != null ? (
            <div
              style={{
                maxWidth: contentMaxWidth,
                width: "100%",
                marginInline: "auto",
              }}
            >
              {children}
            </div>
          ) : (
            children
          )}
        </div>
      </Space>
    </div>
  );
}
