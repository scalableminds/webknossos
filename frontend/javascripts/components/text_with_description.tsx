import { Popover, Tooltip } from "antd";
import Markdown from "libs/markdown_adapter";
import type React from "react";
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
};
type Props = EditableProps | NonEditableProps;

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
    <span
      className={hasDescription ? "flex-container" : ""}
      style={{
        alignItems: "center",
      }}
    >
      <span
        className={hasDescription ? "flex-item" : ""}
        style={{
          flexGrow: 0,
        }}
      >
        {hasDescription ? (
          <Tooltip title="Show description" placement="bottom">
            <Popover title="Description" trigger="click" content={markdownDescription}>
              <i
                className="fas fa-align-justify"
                style={{
                  cursor: "pointer",
                }}
              />
            </Popover>
          </Tooltip>
        ) : null}
      </span>
      <span className={hasDescription ? "flex-item" : undefined}>
        {isEditable ? (
          <EditableTextLabel {...(editableProps as EditableTextLabelProp)} />
        ) : (
          <span
            style={{
              margin: "0 10px",
              display: "inline-block",
            }}
          >
            {(props as NonEditableProps).markdown ? (
              <span>
                <Markdown>{(props as NonEditableProps).value}</Markdown>
              </span>
            ) : (
              (props as NonEditableProps).value
            )}
          </span>
        )}
      </span>
    </span>
  );
};

export default TextWithDescription;
