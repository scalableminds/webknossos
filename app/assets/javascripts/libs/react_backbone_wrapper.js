// @flow
/* globals Class: 0, $PropertyType: 0 */
import React, { Component } from "react";
import Backbone from "backbone";
import { render, unmountComponentAtNode } from "react-dom";

class ReactBackboneWrapper<T: Component<*, *, *>> extends Backbone.View {

  componentClass: Class<T>;
  initialProps: ?$PropertyType<T, 'props'>;

  constructor(componentClass: Class<T>, initialProps?: $PropertyType<T, 'props'> = null) {
    super();
    this.componentClass = componentClass;
    this.initialProps = initialProps;
  }

  render() {
    render(React.createElement(this.componentClass, this.initialProps), this.el);
    return this;
  }

  destroy() {
    unmountComponentAtNode(this.el);
  }
}

export default ReactBackboneWrapper;
