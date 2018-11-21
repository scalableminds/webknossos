// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";

type Props = {
  redirectTo: () => Promise<string>,
  history: RouterHistory,
};

class AsyncRedirect extends React.PureComponent<Props> {
  componentDidMount() {
    this.redirect();
  }

  async redirect() {
    const newPath = await this.props.redirectTo();
    this.props.history.push(newPath);
  }

  render() {
    return null;
  }
}

export default withRouter(AsyncRedirect);
