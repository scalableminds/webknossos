// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";

type Props = {
  redirectTo: () => Promise<string>,
  history: RouterHistory,
  pushToHistory: boolean,
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

export default withRouter(AsyncRedirect);
