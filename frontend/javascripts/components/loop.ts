// @flow
import { Component } from "react";
import window from "libs/window";
type LoopProps = {
  interval: number;
  onTick: (...args: Array<any>) => any;
};

class Loop extends Component<LoopProps, {}> {
  intervalId: number | null | undefined = null;

  componentDidMount() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInterval' does not exist on type '(Wi... Remove this comment to see the full error message
    this.intervalId = window.setInterval(this.props.onTick, this.props.interval);
  }

  componentWillUnmount() {
    if (this.intervalId != null) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'clearInterval' does not exist on type '(... Remove this comment to see the full error message
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  render() {
    return null;
  }
}

export default Loop;
