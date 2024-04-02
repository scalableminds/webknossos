import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import React from "react";

type Props = {
  redirectTo: () => Promise<string>;
  history: RouteComponentProps["history"];
  pushToHistory?: boolean;
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

    if (newPath.startsWith(location.origin)) {
      // The link is absolute which react-router does not support
      // apparently. See https://stackoverflow.com/questions/42914666/react-router-external-link
      if (this.props.pushToHistory) {
        location.assign(newPath);
      } else {
        location.replace(newPath);
      }
      return;
    }

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

export default withRouter<RouteComponentProps & Props, any>(AsyncRedirect);
