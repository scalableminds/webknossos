// @flow
/* eslint-disable react/jsx-no-bind, react/no-multi-comp  */
import { Button, Spin } from "antd";
import * as React from "react";

const onClick = async function(event: SyntheticInputEvent<>) {
  this.setState({ isLoading: true });
  try {
    await this.props.onClick(event);
  } finally {
    if (this._isMounted) {
      this.setState({ isLoading: false });
    }
  }
};

type Props = {
  onClick: (SyntheticInputEvent<>) => Promise<any>,
};

type State = { isLoading: boolean };

export class AsyncButton extends React.PureComponent<Props, State> {
  _isMounted: boolean;
  state = { isLoading: false };

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  render() {
    return <Button {...this.props} loading={this.state.isLoading} onClick={onClick.bind(this)} />;
  }
}

export class AsyncLink extends React.PureComponent<Props & { children: React.Node }, State> {
  _isMounted: boolean;
  static defaultProps = {
    children: [],
  };

  state = { isLoading: false };

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  render() {
    let content;
    if (this.state.isLoading) {
      const children = React.Children.toArray(this.props.children);
      const childrenWithoutIcon = children.filter(child => !child.type || child.type !== "i");
      content = [<Spin key="icon" />, childrenWithoutIcon];
    } else {
      content = this.props.children;
    }

    return (
      <a {...this.props} onClick={onClick.bind(this)}>
        {content}
      </a>
    );
  }
}

export default {};
