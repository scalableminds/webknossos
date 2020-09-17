// @flow

import { Input, Icon, Tooltip } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";

import { MarkdownModal } from "oxalis/view/components/markdown_modal";
import Toast from "libs/toast";

type Rule = {
  message?: string,
  type?: string,
};

export type EditableTextLabelProp = {|
  value: string,
  onChange: Function,
  rules?: Rule,
  rows?: number,
  markdown?: boolean,
  label: string,
|};

type State = {
  isEditing: boolean,
  value: string,
};

class EditableTextLabel extends React.PureComponent<EditableTextLabelProp, State> {
  static defaultProps = {
    rows: 1,
  };

  state = {
    isEditing: false,
    value: "",
  };

  componentDidMount() {
    this.setState({ value: this.props.value });
  }

  componentWillReceiveProps(newProps: EditableTextLabelProp) {
    if (this.props.value !== newProps.value) this.setState({ value: newProps.value });
  }

  handleInputChange = (event: SyntheticInputEvent<>) => {
    this.setState({ value: event.target.value });
  };

  handleOnChange = () => {
    if (this.validateFields()) {
      this.props.onChange(this.state.value);
      this.setState({ isEditing: false });
    }
  };

  validateFields() {
    if (this.props.rules && this.props.rules.type === "email") {
      const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
      const matchesEmail = re.test(this.state.value);
      if (!matchesEmail && this.props.rules && this.props.rules.message)
        Toast.error(this.props.rules.message);
      return matchesEmail;
    } else {
      return true;
    }
  }

  render() {
    const iconStyle = { cursor: "pointer" };

    const inputComponentProps = {
      value: this.state.value,
      onChange: this.handleInputChange,
      onPressEnter: this.handleOnChange,
      style: { width: "60%", margin: "0 10px" },
      size: "small",
      autoFocus: true,
      rows: this.props.rows,
    };

    if (this.state.isEditing) {
      return (
        <span>
          {this.props.rows === 1 ? (
            <React.Fragment>
              <Input {...inputComponentProps} />
              <Tooltip key="save" title={`Save ${this.props.label}`} placement="bottom">
                <Icon
                  type="check"
                  style={iconStyle}
                  onClick={evt => {
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
        <span style={{ display: "inline-block" }}>
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
          <Tooltip key="edit" title={`Edit ${this.props.label}`} placement="bottom">
            <Icon
              type="edit"
              style={iconStyle}
              onClick={evt => {
                evt.stopPropagation();
                this.setState({ isEditing: true });
              }}
            />
          </Tooltip>
        </span>
      );
    }
  }
}

export default EditableTextLabel;
