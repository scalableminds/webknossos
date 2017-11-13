// @flow
import React from "react";

type Props = {
  backboneView: any,
};

class BackboneWrapper extends React.Component<Props> {
  container: ?HTMLDivElement;

  componentDidMount() {
    this.attachProps(this.props);
    if (this.container) this.container.appendChild(this.props.backboneView.render().el);
  }

  componentWillReceiveProps(newProps: Props) {
    this.attachProps(newProps);
  }

  componentWillUnmount() {
    const { backboneView } = this.props;
    if (backboneView.destroy) {
      backboneView.destroy();
    } else {
      backboneView.remove();
    }
  }

  attachProps(props: Props) {
    const { backboneView, ...restProps } = props;
    backboneView.props = restProps;
  }

  render() {
    return (
      <div key={this.props.backboneView.toString()}>
        <div
          ref={el => {
            this.container = el;
          }}
        />
      </div>
    );
  }
}

export default BackboneWrapper;
