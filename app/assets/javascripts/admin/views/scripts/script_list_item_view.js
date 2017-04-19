import _ from "lodash";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import window from "libs/window";

class ScriptListItemView extends Marionette.View {

  static initClass() {
    this.prototype.tagName = "tr";
    this.prototype.template = _.template(`\
    <td><%- name %></td>
    <td><%- owner.firstName %> <%- owner.lastName %></td>
    <td><a href="<%- gist %>" target="_blank"><%- gist %></td>\
    <td class="nowrap">
      <a href="/scripts/<%- id %>/edit"><i class="fa fa-pencil"></i>edit</a><br>
      <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
    </td>\
    `);

    this.prototype.events = {
      "click .delete": "delete"
    }
  }

  delete() {
    if (window.confirm("Do you really want to delete this script?")){
      this.model.destroy();
    }
  }
}
ScriptListItemView.initClass();

export default ScriptListItemView;
