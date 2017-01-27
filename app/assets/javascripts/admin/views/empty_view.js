/**
 * empty_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";

class EmptyView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
      <h4>There is no data for this view yet.</h4>\
    `);
  }
}
EmptyView.initClass();


export default EmptyView;
