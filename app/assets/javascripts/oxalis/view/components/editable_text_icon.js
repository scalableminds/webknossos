// @flow

import React from "react";
import { Input, Icon } from "antd";

type EditableTextIconPropType = {
  icon: string,
  onChange: Function,
};

class EditableTextIcon extends React.PureComponent {
  props: EditableTextIconPropType;

  state: {
    isEditing: boolean,
    value: string,
  } = {
    isEditing: false,
    value: "",
  };

  handleInputChange = (event: SyntheticInputEvent) => {
    this.setState({ value: event.target.value });
  };

  handleOnChange = () => {
    const value = this.state.value;

    if (value !== "") {
      this.props.onChange(this.state.value);
    }
    this.setState({ isEditing: false, value: "" });
  };

  render() {
    const iconStyle = { cursor: "pointer" };

    if (this.state.isEditing) {
      return (
        <Input
          value={this.state.value}
          onChange={this.handleInputChange}
          onPressEnter={this.handleOnChange}
          onBlur={this.handleOnChange}
          style={{ width: 75 }}
          size="small"
          autoFocus
        />
      );
    } else {
      return (
        <Icon
          type={this.props.icon}
          style={iconStyle}
          onClick={() => this.setState({ isEditing: true })}
        />
      );
    }
  }
}

export default EditableTextIcon;
