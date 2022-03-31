// @ts-expect-error ts-migrate(2305) FIXME: Module '"react-router-dom"' has no exported member... Remove this comment to see the full error message
import type { RouterHistory } from "react-router-dom";
import { withRouter } from "react-router-dom";
import React from "react";
type Props = {
  redirectTo: () => Promise<string>;
  history: RouterHistory;
  pushToHistory: boolean;
};

class AsyncRedirect extends React.PureComponent<Props> {
  static defaultProps = {
    pushToHistory: true,
  };

  componentDidMount() {
    this.redirect();
  }

  async redirect() {
    const newPath = await this.props.redirectTo();

    if (this.props.pushToHistory) {
      this.props.history.push(newPath);
    } else {
      this.props.history.replace(newPath);
    }
  }

  render() {
    return null;
  }
}

// @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof AsyncRedirect' is not ass... Remove this comment to see the full error message
export default withRouter(AsyncRedirect);
