import { CheckOutlined, EditOutlined } from "@ant-design/icons";
import { Input, type InputProps, Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import Markdown from "libs/markdown_adapter";
import Toast from "libs/toast";
import * as React from "react";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import type { ValidationResult } from "../left-border-tabs/modals/add_volume_layer_modal";

type Rule = {
  message?: string;
  type?: string;
  min?: number;
  validator?: (arg0: string) => ValidationResult;
};
export type EditableTextLabelProp = {
  value: string;
  onChange: (newValue: string) => any;
  rules?: Rule[];
  rows?: number;
  markdown?: boolean;
  label: string;
  margin?: number | string;
  onClick?: () => void;
  disableEditing?: boolean;
  hideEditIcon?: boolean;
  onContextMenu?: () => void;
  width?: string | number;
  iconClassName?: string;
  isInvalid?: boolean | null | undefined;
  trimValue?: boolean | null | undefined;
  onRenameStart?: (() => void) | undefined;
  onRenameEnd?: (() => void) | undefined;
};
type State = {
  isEditing: boolean;
  value: string;
};

class EditableTextLabel extends React.PureComponent<EditableTextLabelProp, State> {
  static defaultProps = {
    rows: 1,
    isInvalid: false,
    trimValue: false,
    rules: [],
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

  handleInputChangeFromEvent = (
    event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    this.setState({
      value: event.target.value,
    });
  };

  handleInputChange = (newValue: string) => {
    this.setState({
      value: newValue,
    });
  };

  handleOnChange = () => {
    const validateAndUpdateValue = () => {
      if (this.validateFields()) {
        this.props.onChange(this.state.value);
        this.setState({
          isEditing: false,
        });
        if (this.props.onRenameEnd) {
          this.props.onRenameEnd();
        }
      }
    };
    if (this.props.trimValue) {
      this.setState(
        (prevState) => ({ value: prevState.value.trim() }),
        // afterwards validate
        validateAndUpdateValue,
      );
    } else {
      validateAndUpdateValue();
    }
  };

  validateFields() {
    if (!this.props.rules) {
      return true;
    }
    const allRulesValid = this.props.rules.every((rule) => {
      if (rule.type === "email") {
        const re =
          /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        const isValid = re.test(this.state.value);
        if (!isValid) {
          Toast.error(rule.message);
          return false;
        }
      } else if (rule.validator != null) {
        const validationResult = rule.validator(this.state.value);
        if (!validationResult.isValid) {
          Toast.error(validationResult.message);
          return false;
        }
      } else if (rule.min != null) {
        if (this.state.value.length < rule.min) {
          Toast.error(`Length must at least be ${rule.min}.`);
          return false;
        }
      }
      return true;
    });
    return allRulesValid;
  }

  render() {
    const iconStyle = {
      cursor: "pointer",
      marginLeft: 5,
    };
    const margin = this.props.margin != null ? this.props.margin : "0 10px";
    const inputComponentProps: InputProps = {
      value: this.state.value,
      onChange: this.handleInputChangeFromEvent,
      onPressEnter: this.handleOnChange,
      style: {
        width: this.props.width != null ? this.props.width : "calc(100% - 24px)",
        margin,
      },
      size: "small",
      autoFocus: true,
    };
    const isInvalidStyleMaybe = this.props.isInvalid ? { color: "var(--ant-color-error)" } : {};
    const onRename = (evt: React.MouseEvent) => {
      if (this.props.disableEditing) {
        return;
      }
      evt.stopPropagation();
      this.setState({
        isEditing: true,
      });
      if (this.props.onRenameStart) {
        this.props.onRenameStart();
      }
    };

    if (this.state.isEditing) {
      return this.props.rows === 1 ? (
        <Space.Compact block>
          <Input {...inputComponentProps} onBlur={() => this.handleOnChange()} />
          <FastTooltip key="save" title={`Save ${this.props.label}`} placement="bottom">
            <CheckOutlined
              style={iconStyle}
              onClick={(evt) => {
                evt.stopPropagation();
                this.handleOnChange();
              }}
            />
          </FastTooltip>
        </Space.Compact>
      ) : (
        <MarkdownModal
          source={this.state.value}
          isOpen={this.state.isEditing}
          onChange={this.handleInputChange}
          onOk={this.handleOnChange}
          label={this.props.label}
        />
      );
    } else {
      return (
        <div
          style={{
            margin,
            display: "inline-flex",
            alignItems: "center",
          }}
          className={this.props.onClick != null ? "clickable-text" : undefined}
          onClick={this.props.onClick}
          onDoubleClick={onRename}
          onContextMenu={this.props.onContextMenu}
        >
          {this.props.markdown ? (
            <span style={isInvalidStyleMaybe}>
              <Markdown className="flex-item">{this.props.value}</Markdown>
            </span>
          ) : (
            <span style={isInvalidStyleMaybe}>{this.props.value}</span>
          )}
          {this.props.disableEditing || this.props.hideEditIcon ? null : (
            <FastTooltip key="edit" title={`Edit ${this.props.label}`} placement="bottom">
              <EditOutlined
                className={
                  this.props.iconClassName + " " + (this.props.markdown ? "flex-item" : "")
                }
                style={{
                  ...iconStyle,
                  display: "inline",
                  whiteSpace: "nowrap",
                }}
                onClick={onRename}
              />
            </FastTooltip>
          )}
        </div>
      );
    }
  }
}

export default EditableTextLabel;
