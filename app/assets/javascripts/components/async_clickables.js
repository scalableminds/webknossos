// @flow
/* eslint-disable react/no-unused-prop-types, react/no-unused-props, react/jsx-no-bind, react/no-multi-comp  */
import React from "react";
import { Button, Spin } from "antd";

const ReactElement = React.Element;

const onClick = async function() {
  this.setState({ isLoading: true });
  await this.props.onClick();
  if (this._isMounted) {
    this.setState({ isLoading: false });
  }
};

type Props = {
  onClick: () => Promise<any>,
};

type State = { isLoading: boolean };

export class AsyncButton extends React.PureComponent {
  props: Props;
  _isMounted: boolean;
  state: State = { isLoading: false };

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

export class AsyncLink extends React.PureComponent {
  props: Props & { children: Array<ReactElement<*>> };
  _isMounted: boolean;
  static defaultProps = {
    children: [],
  };
  state: State = { isLoading: false };

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  render() {
    let content;
    if (this.state.isLoading) {
      const childrenWithoutIcon = this.props.children.filter(child => child.type !== "i");
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
