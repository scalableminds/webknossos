import _ from "lodash";
import Marionette from "backbone.marionette";
import Subviews from "backbone-subviews";

class CategoryView extends Marionette.View {
  static initClass() {
    // Abstract class to create category views. Subclasses must specify
    // `subviewCreatorsList` like so:
    //
    // subviewCreatorsList: [
    //   [
    //     "unique_view_id", ->
    //       # Create & return subview
    //   ]
    // ]

    this.prototype.template = _.template(`\
<div class="panel panel-default">
  <div class="panel-heading" data-toggle="collapse" data-target="#user-settings-<%- tabId %>">
    <h4 class="panel-title">
      <a>
        <i class="caret-down"></i>
        <i class="caret-right"></i>
        <%- caption %>
      </a>
    </h4>
  </div>
  <div id="user-settings-<%- tabId %>" class="panel-collapse collapse in">
    <div class="panel-body">
  
      <% _.forEach(subviewCreatorsList, function (key_value_pair) { %>
        <div data-subview="<%- key_value_pair[0] %>"></div>
      <% }) %>
  
    </div>
  </div>
</div>\
`);
  }


  initialize() {
    if (this.subviewCreatorsList == null) {
      throw new Error(
        "Subclasses of CategoryView must specify subviewCreatorsList");
    }

    // subviewCreators hash needed for Subviews extension
    this.subviewCreators = _.transform(
      this.subviewCreatorsList,
      (result, [key, value]) => result[key] = value,
      {},
    );

    return Subviews.add(this);
  }


  serializeData() {
    return { subviewCreatorsList: this.subviewCreatorsList, caption: this.caption, tabId: _.uniqueId() };
  }


  hide() {
    return this.$el.hide();
  }


  show() {
    return this.$el.show();
  }
}
CategoryView.initClass();

export default CategoryView;
