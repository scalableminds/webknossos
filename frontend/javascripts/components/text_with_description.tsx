import { Popover, Tooltip } from "antd";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import * as React from "react";
import type { EditableTextLabelProp } from "oxalis/view/components/editable_text_label";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
type EditableProps = EditableTextLabelProp & {
  isEditable: true;
  description: string;
};
type NonEditableProps = {
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
        <Markdown
          source={description}
          options={{
            html: false,
            breaks: true,
            linkify: true,
          }}
        />
      </div>
    );
    return (
      <span
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message
        className={hasDescription ? "flex-container" : null}
        style={{
          alignItems: "center",
        }}
      >
        <span
          // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message
          className={hasDescription ? "flex-item" : null}
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
        {/* @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message */}
        <span className={hasDescription ? "flex-item" : null}>
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
              {/* @ts-expect-error ts-migrate(2339) FIXME: Property 'markdown' does not exist on type 'Readon... Remove this comment to see the full error message */}
              {this.props.markdown ? (
                <Markdown
                  source={this.props.value}
                  options={{
                    html: false,
                    breaks: true,
                    linkify: true,
                  }}
                  container="span"
                />
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
