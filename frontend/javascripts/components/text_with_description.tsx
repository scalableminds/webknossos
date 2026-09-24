import { AlignCenterOutlined } from "@ant-design/icons";
import { Button, Popover, Tooltip } from "antd";
import Markdown from "libs/markdown_adapter";
import type React from "react";
import { Link } from "react-router";
import type { EditableTextLabelProp } from "viewer/view/components/editable_text_label";
import EditableTextLabel from "viewer/view/components/editable_text_label";

type EditableProps = EditableTextLabelProp & {
  isEditable: true;
  description: string;
};
type NonEditableProps = {
  markdown?: boolean;
  isEditable: false;
  description: string;
  value: string;
  linkTarget?: string;
  linkTitle?: string;
};
type Props = EditableProps | NonEditableProps;

function NonEditableText({ markdown, value, linkTarget, linkTitle }: NonEditableProps) {
  const text = markdown ? (
    <span>
      <Markdown>{value}</Markdown>
    </span>
  ) : (
    value
  );
  return (
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
  );
}

const TextWithDescription: React.FC<Props> = (props) => {
  const { isEditable, description, ...editableProps } = props;
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
      {isEditable ? (
        <EditableTextLabel {...(editableProps as EditableTextLabelProp)} />
      ) : (
        <NonEditableText {...(props as NonEditableProps)} />
      )}
      {hasDescription ? (
        <Tooltip title="Show description" placement="bottom">
          <Popover title="Description" trigger="click" content={markdownDescription}>
            <Button
              size="small"
              color="default"
              variant="text"
              icon={<AlignCenterOutlined />}
              style={{ marginInlineStart: 4 }}
            />
          </Popover>
        </Tooltip>
      ) : null}
    </span>
  );
};

export default TextWithDescription;
