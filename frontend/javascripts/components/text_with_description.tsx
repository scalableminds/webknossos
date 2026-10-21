import { AlignLeftOutlined } from "@ant-design/icons";
import { Button, Popover, Tooltip } from "antd";
import Markdown from "libs/markdown_adapter";
import type React from "react";
import { Link } from "react-router";

type Props = {
  value: string;
  // Shown when `value` is empty.
  placeholder?: string;
  description: string;
  linkTarget?: string;
  linkTitle?: string;
};

const TextWithDescription: React.FC<Props> = ({
  value,
  placeholder,
  description,
  linkTarget,
  linkTitle,
}) => {
  const text = value.trim() ? value : placeholder;
  const hasDescription = description !== "";
  const markdownDescription = (
    <div
      style={{
        maxWidth: 400,
      }}
    >
      <Markdown>{description}</Markdown>
    </div>
  );
  return (
    <span style={{ wordBreak: "break-word" }}>
      <span
        style={{
          display: "inline-block",
        }}
      >
        {linkTarget != null ? (
          <Link to={linkTarget} title={linkTitle} className="incognito-link">
            {text}
          </Link>
        ) : (
          text
        )}
      </span>
      {hasDescription ? (
        <Tooltip title="Show description" placement="bottom">
          <Popover title="Description" trigger="click" content={markdownDescription}>
            <Button
              size="small"
              color="default"
              variant="text"
              icon={<AlignLeftOutlined />}
              style={{ marginInlineStart: 4 }}
            />
          </Popover>
        </Tooltip>
      ) : null}
    </span>
  );
};

export default TextWithDescription;
