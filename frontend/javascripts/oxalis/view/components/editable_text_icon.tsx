// @flow
import { Input } from "antd";
// @ts-expect-error ts-migrate(2724) FIXME: '"react"' has no exported member named 'Element'. ... Remove this comment to see the full error message
import type { Element } from "react";
import React from "react";
type Props = {
  icon: Element<any>;
  onChange: (...args: Array<any>) => any;
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

  handleInputChange = (event: React.SyntheticEvent) => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      value: event.target.value,
    });
  };

  handleInputSubmit = (event: React.SyntheticEvent) => {
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
    const iconStyle = {
      cursor: "pointer",
    };

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
    } else {
      return React.cloneElement(this.props.icon, {
        style: iconStyle,
        onClick: () =>
          this.setState({
            isEditing: true,
          }),
      });
    }
  }
}

export default EditableTextIcon;
