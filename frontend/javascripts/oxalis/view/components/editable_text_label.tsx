import { Input, InputProps, Tooltip } from "antd";
import { CheckOutlined, EditOutlined } from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import * as React from "react";
import { MarkdownModal } from "oxalis/view/components/markdown_modal";
import Toast from "libs/toast";
type Rule = {
  message?: string;
  type?: string;
};
export type EditableTextLabelProp = {
  value: string;
  onChange: (...args: Array<any>) => any;
  rules?: Rule;
  rows?: number;
  markdown?: boolean;
  label: string;
  margin?: number | string;
  onClick?: () => void;
  disableEditing?: boolean;
  onContextMenu?: () => void;
  width?: string | number;
};
type State = {
  isEditing: boolean;
  value: string;
};

class EditableTextLabel extends React.PureComponent<EditableTextLabelProp, State> {
  static defaultProps = {
    rows: 1,
  };
  state: State = {
    isEditing: false,
    value: "",
  };

  componentDidMount() {
    this.setState({
      value: this.props.value,
    });
  }

  componentDidUpdate(prevProps: EditableTextLabelProp) {
    if (prevProps.value !== this.props.value) {
      this.setState({
        value: this.props.value,
      });
    }
  }

  handleInputChange = (event: React.SyntheticEvent) => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      value: event.target.value,
    });
  };
  handleOnChange = () => {
    if (this.validateFields()) {
      this.props.onChange(this.state.value);
      this.setState({
        isEditing: false,
      });
    }
  };

  validateFields() {
    if (this.props.rules && this.props.rules.type === "email") {
      const re =
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
      const matchesEmail = re.test(this.state.value);
      if (!matchesEmail && this.props.rules && this.props.rules.message)
        Toast.error(this.props.rules.message);
      return matchesEmail;
    } else {
      return true;
    }
  }

  render() {
    const iconStyle = {
      cursor: "pointer",
    };
    const margin = this.props.margin != null ? this.props.margin : "0 10px";
    const inputComponentProps: InputProps = {
      value: this.state.value,
      onChange: this.handleInputChange,
      onPressEnter: this.handleOnChange,
      style: {
        width: this.props.width != null ? this.props.width : "60%",
        margin,
      },
      size: "small",
      autoFocus: true,
      // @ts-ignore
      rows: this.props.rows,
    };

    if (this.state.isEditing) {
      return (
        <span>
          {this.props.rows === 1 ? (
            <React.Fragment>
              <Input {...inputComponentProps} onBlur={() => this.handleOnChange} />
              <Tooltip key="save" title={`Save ${this.props.label}`} placement="bottom">
                <CheckOutlined
                  style={iconStyle}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    this.handleOnChange();
                  }}
                />
              </Tooltip>
            </React.Fragment>
          ) : (
            <MarkdownModal
              source={this.state.value}
              visible={this.state.isEditing}
              onChange={this.handleInputChange}
              onOk={this.handleOnChange}
              label={this.props.label}
            />
          )}
        </span>
      );
    } else {
      return (
        /* @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message */
        <span className={this.props.markdown ? "flex-container" : null}>
          <span
            style={{
              margin,
              display: "inline-block",
            }}
            /* @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message */
            className={this.props.onClick != null ? "clickable-text" : null}
            onClick={this.props.onClick}
            onContextMenu={this.props.onContextMenu}
          >
            {this.props.markdown ? (
              <Markdown
                className="flex-item"
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
            {this.props.disableEditing ? null : (
              <Tooltip key="edit" title={`Edit ${this.props.label}`} placement="bottom">
                <EditOutlined
                  /* @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message */
                  className={this.props.markdown ? "flex-item" : null}
                  style={{
                    /* @ts-expect-error ts-migrate(2322) FIXME: Type '{ iconStyle: { cursor: string; }; marginLeft... Remove this comment to see the full error message */
                    iconStyle,
                    marginLeft: 5,
                    display: "inline",
                    whiteSpace: "nowrap",
                  }}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    this.setState({
                      isEditing: true,
                    });
                  }}
                />
              </Tooltip>
            )}
          </span>
        </span>
      );
    }
  }
}

export default EditableTextLabel;
