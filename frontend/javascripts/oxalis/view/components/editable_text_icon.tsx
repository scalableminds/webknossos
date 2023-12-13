import { Button, Input } from "antd";
import React from "react";

type Props = {
  icon: React.ReactElement;
  label?: string;
  onChange: (value: string, event: React.SyntheticEvent<HTMLInputElement>) => void;
};

type State = {
  isEditing: boolean;
  value: string;
};

class EditableTextIcon extends React.PureComponent<Props, State> {
  state = {
    isEditing: false,
    value: "",
  };

  handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      value: event.target.value,
    });
  };

  handleInputSubmit = (event: React.SyntheticEvent<HTMLInputElement>) => {
    const { value } = this.state;

    if (value !== "") {
      this.props.onChange(this.state.value, event);
    }

    this.setState({
      isEditing: false,
      value: "",
    });
  };

  render() {
    if (this.state.isEditing) {
      return (
        <Input
          value={this.state.value}
          onChange={this.handleInputChange}
          onPressEnter={this.handleInputSubmit}
          onBlur={this.handleInputSubmit}
          style={{
            width: 75,
          }}
          size="small"
          autoFocus
        />
      );
    }

    return (
      <Button
        size="small"
        icon={this.props.icon}
        style={{
          height: 22,
          width: this.props.label ? "initial" : 22,
          fontSize: "12px",
          color: "#7c7c7c",
        }}
        onClick={() =>
          this.setState({
            isEditing: true,
          })
        }
      >
        {this.props.label ? <span style={{ marginLeft: 0 }}>{this.props.label}</span> : null}
      </Button>
    );
  }
}

export default EditableTextIcon;
