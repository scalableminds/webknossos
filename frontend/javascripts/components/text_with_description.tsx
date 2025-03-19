import { Popover, Tooltip } from "antd";
import Markdown from "libs/markdown_adapter";
import type { EditableTextLabelProp } from "oxalis/view/components/editable_text_label";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import * as React from "react";

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

class TextWithDescription extends React.PureComponent<Props> {
  render() {
    const { isEditable, description, ...editableProps } = this.props;
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
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            <EditableTextLabel {...editableProps} />
          ) : (
            <span
              style={{
                margin: "0 10px",
                display: "inline-block",
              }}
            >
              {this.props.markdown ? (
                <span>
                  <Markdown>{this.props.value}</Markdown>
                </span>
              ) : (
                this.props.value
              )}
            </span>
          )}
        </span>
      </span>
    );
  }
}

export default TextWithDescription;
