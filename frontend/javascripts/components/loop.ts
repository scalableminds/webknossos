import { Component } from "react";
import window from "libs/window";
type LoopProps = {
  interval: number;
  onTick: (...args: Array<any>) => any;
};

class Loop extends Component<LoopProps, {}> {
  intervalId: number | null | undefined = null;

  componentDidMount() {
    this.intervalId = window.setInterval(this.props.onTick, this.props.interval);
  }

  componentWillUnmount() {
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  render() {
    return null;
  }
}

export default Loop;