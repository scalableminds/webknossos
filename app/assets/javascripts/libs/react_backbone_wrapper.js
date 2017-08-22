// @flow
import * as React from "react";
import Backbone from "backbone";
import { LocaleProvider } from "antd";
import enUS from "antd/lib/locale-provider/en_US";
import { render, unmountComponentAtNode } from "react-dom";

class ReactBackboneWrapper<P: Object, T: React.ComponentType<P>> extends Backbone.View {
  componentClass: T;
  initialProps: P;

  constructor(componentClass: T, initialProps: P) {
    super();
    this.componentClass = componentClass;
    this.initialProps = initialProps;
  }

  render() {
    render(
      React.createElement(
        LocaleProvider,
        { locale: enUS },
        // $FlowFixMe: Flow says initialProps are wrong?
        React.createElement(this.componentClass, this.initialProps),
      ),
      this.el,
    );
    return this;
  }

  destroy() {
    unmountComponentAtNode(this.el);
  }
}

export default ReactBackboneWrapper;
