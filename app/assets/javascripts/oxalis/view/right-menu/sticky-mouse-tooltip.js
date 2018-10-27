// @flow

import * as React from "react";

type Props = {
  displayText: string,
};
type State = {
  x: number,
  y: number,
};

class StickyMouseTooltip extends React.PureComponent<Props, State> {
  state = {
    x: 0,
    y: 0,
  };

  componentDidMount() {
    console.log("binding");
    window.addEventListener("mousemove", this.handleMouseMovement, false);
  }

  componentWillUnmount() {
    console.log("unbinding");
    // you need to unbind the same listener that was binded.
    window.removeEventListener("mousemove", this.handleMouseMovement, false);
  }

  handleMouseMovement = (evt: MouseEvent) => {
    console.log("changing position", evt);
    this.setState({ x: evt.pageX, y: evt.pageY });
  };

  render() {
    const { x, y } = this.state;
    console.log("rendering", "x:", this.state.x, "y", this.state.y);
    return (
      <span style={{ color: "pink", position: "fixed", top: y, left: x, backgroundColor: "black" }}>
        {this.props.displayText}
      </span>
    );
  }
}

export default StickyMouseTooltip;
