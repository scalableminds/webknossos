// @flow

import React from "react";
import { Input, Icon } from "antd";

type EditableTextLabelPropType = {
  value: string,
  onChange: Function,
};

class EditableTextLabel extends React.PureComponent {
  props: EditableTextLabelPropType;

  state: {
    isEditing: boolean,
    value: string,
  } = {
    isEditing: false,
    value: "",
  };

  componentWillReceiveProps(newProps: EditableTextLabelPropType) {
    this.setState({ value: newProps.value });
  }

  handleInputChange = (event: SyntheticInputEvent) => {
    this.setState({ value: event.target.value });
  };

  handleOnChange = () => {
    this.setState({ isEditing: false });
    this.props.onChange(this.state.value);
  };

  render() {
    const iconStyle = { cursor: "pointer" };

    if (this.state.isEditing) {
      return (
        <span>
          <Input
            value={this.state.value}
            onChange={this.handleInputChange}
            onPressEnter={this.handleOnChange}
            style={{ width: "60%", margin: "0 10px" }}
            size="small"
          />
          <Icon type="check" style={iconStyle} onClick={this.handleOnChange} />
        </span>
      );
    } else {
      return (
        <span>
          <span style={{ margin: "0 10px" }}>
            {this.props.value}
          </span>
          <Icon type="edit" style={iconStyle} onClick={() => this.setState({ isEditing: true })} />
        </span>
      );
    }
  }
}

export default EditableTextLabel;
