// @flow
import React from "react";

type Props = {
  backboneView: any,
};

class BackboneWrapper extends React.Component<Props> {
  container: ?HTMLDivElement;

  componentDidMount() {
    if (this.container) this.container.appendChild(this.props.backboneView.render().el);
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
