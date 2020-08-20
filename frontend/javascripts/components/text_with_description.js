// @flow

import { Popover, Tooltip } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";
import EditableTextLabel, {
  type EditableTextLabelProp,
} from "oxalis/view/components/editable_text_label";

type EditableProps = {
  isEditable: true,
  description: string,
  ...EditableTextLabelProp,
};
type NonEditableProps = { isEditable: false, description: string, value: string };
type Props = EditableProps | NonEditableProps;

class TextWithDescription extends React.PureComponent<Props> {
  render() {
    const { isEditable, description, ...editableProps } = this.props;

    const hasDescription = description !== "";
    const markdownDescription = (
      <div style={{ maxWidth: 400 }}>
        <Markdown source={description} options={{ html: false, breaks: true, linkify: true }} />
      </div>
    );

    return (
      <React.Fragment>
        {isEditable ? (
          <EditableTextLabel {...editableProps} />
        ) : (
          <span style={{ margin: "0 10px", display: "inline-block" }}>
            {this.props.markdown ? (
              <Markdown
                source={this.props.value}
                options={{ html: false, breaks: true, linkify: true }}
                container="span"
              />
            ) : (
              this.props.value
            )}
          </span>
        )}
        {hasDescription ? (
          <Tooltip title="Show description" placement="bottom">
            <Popover title="Description" trigger="click" content={markdownDescription}>
              <i className="fa fa-align-justify" style={{ cursor: "pointer" }} />
            </Popover>
          </Tooltip>
        ) : null}
      </React.Fragment>
    );
  }
}

export default TextWithDescription;
