import window from "libs/window";
import { Component } from "react";
import type { EmptyObject } from "types/globals";
type LoopProps = {
  interval: number;
  onTick: (...args: Array<any>) => any;
};

class Loop extends Component<LoopProps, EmptyObject> {
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
