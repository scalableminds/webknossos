/**
 * explorative_tracing_list_item_view.js
 * @flow weak
 */

import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import HoverShowHide from "libs/behaviors/hover_show_hide_behavior";
import Request from "libs/request";

class ExplorativeTracingListItemView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "tr";
    this.prototype.template = _.template(`\
<td>
  <div class="monospace-id">
    <%- id %>
  </div>
</td>
<td class="explorative-name-column hover-dynamic">
  <span class="hover-hide" id="explorative-tracing-name"><%- name %></span>
  <div class="hover-show hide">
    <input
      class="hover-input form-control"
      name="name"
      id="explorative-name-input"
      type="text"
      value="<%- name %>"
      autocomplete="off">
  </div>
</td>
<td><%- dataSetName %></td>

<td class="nowrap">
  <% if (stats && (contentType == "skeletonTracing")) { %>
    <span title="Trees"><i class="fa fa-sitemap"></i><%- stats.numberOfTrees %>&nbsp;</span><br />
    <span title="Nodes"><i class="fa fa-bull"></i><%- stats.numberOfNodes %>&nbsp;</span><br />
    <span title="Edges"><i class="fa fa-arrows-h"></i><%- stats.numberOfEdges %></span>
  <% } %>
</td>

<td><%- contentType + " - " + typ %></td>
<td><%- created %></td>
<td class="nowrap">
  <% if (typ == "Explorational"){ %>
    <% if (!state.isFinished) {%>
      <a href="<%- jsRoutes.controllers.AnnotationController.trace(typ, id).url %>">
        <i class="fa fa-random"></i>
        <strong>trace</strong>
      </a><br />
      <a href="<%- jsRoutes.controllers.AnnotationIOController.download(typ, id).url %>">
        <i class="fa fa-download"></i>
        download
      </a><br />
      <a href="<%- jsRoutes.controllers.AnnotationController.finish(typ, id).url %>"
         id="finish-tracing">
        <i class="fa fa-archive"></i>
        archive
      </a><br />
    <% } else {%>
      <a href="<%- jsRoutes.controllers.AnnotationController.reopen(typ, id).url %>"
         id="reopen-tracing">
        <i class="fa fa-folder-open"></i>
        reopen
      </a><br />
    <% } %>
  <% } %>
</td>\
`);

    this.prototype.events = {
      "click #finish-tracing": "finishOrOpenTracing",
      "click #reopen-tracing": "finishOrOpenTracing",
      "change @ui.explorativeNameInput": "nameExplorativeAnnotation",
    };

    this.prototype.ui = {
      explorativeNameInput: "#explorative-name-input",
    };

    this.prototype.behaviors = {
      HoverShowHide: {
        behaviorClass: HoverShowHide,
      },
    };
  }

  nameExplorativeAnnotation(event) {
    event.preventDefault();
    const payload = { data: { name: event.target.value } };
    const url = `/annotations/${this.model.get("typ")}/${this.model.get("id")}/name`;

    Request.sendJSONReceiveJSON(url, payload).then(response => {
      Toast.message(response.messages);
      const newName = this.$("input[name='name']").val();
      this.model.set("name", newName);
      this.render();
    });
  }

  toggleState(state) {
    state.isFinished = !state.isFinished;
  }

  finishOrOpenTracing(event) {
    event.preventDefault();
    const url = $(event.target).attr("href") || $(event.target.parentElement).attr("href");

    Request.receiveJSON(url).then(response => {
      Toast.message(response.messages);
      this.toggleState(this.model.attributes.state);
      this.model.collection.remove(this.model);
      this.options.parent.render();
    });
  }
}
ExplorativeTracingListItemView.initClass();

export default ExplorativeTracingListItemView;
