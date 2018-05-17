// @flow

import * as React from "react";
import { Input, Icon } from "antd";
import Toast from "../../../libs/toast";

type Rule = {
  message?: string,
  type?: string,
};

type EditableTextLabelPropType = {
  value: string,
  onChange: Function,
  rules?: Rule,
  rows?: number,
};

type State = {
  isEditing: boolean,
  value: string,
};

class EditableTextLabel extends React.PureComponent<EditableTextLabelPropType, State> {
  static defaultProps = {
    rows: 1,
  };

  state = {
    isEditing: false,
    value: "",
  };

  componentDidMount() {
    this.componentWillReceiveProps(this.props);
  }

  componentWillReceiveProps(newProps: EditableTextLabelPropType) {
    this.setState({ value: newProps.value });
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
      if (!matchesEmail && this.props.rules && this.props.rules.message) Toast.error(this.props.rules.message);
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
            <Input {...inputComponentProps} />
          ) : (
            <Input.TextArea {...inputComponentProps} />
          )}
          <Icon type="check" style={iconStyle} onClick={this.handleOnChange} />
        </span>
      );
    } else {
      return (
        <span>
          <span style={{ margin: "0 10px" }}>{this.props.value}</span>
          <Icon type="edit" style={iconStyle} onClick={() => this.setState({ isEditing: true })} />
        </span>
      );
    }
  }
}

export default EditableTextLabel;
