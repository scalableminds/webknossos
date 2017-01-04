import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import routes from "routes"; // eslint-disable-line no-unused-vars
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
  <form action="<%- jsRoutes.controllers.AnnotationController.nameExplorativeAnnotation(typ, id).url %>"
    method="POST" class="hover-show hide" id="explorative-name-form">
    <div class="input-append">
      <input class="input-medium hover-input form-control"
             name="name"
             id="explorative-name-input"
             maxlength="50"
             type="text"
             value="<%- name %>"
             autocomplete="off">
    </div>
  </form>
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
      "submit #explorative-name-form": "nameExplorativeAnnotation",
      "click #finish-tracing": "finishOrOpenTracing",
      "click #reopen-tracing": "finishOrOpenTracing",
      "change @ui.explorativeNameInput": "submitForm",
    };

    this.prototype.ui = {
      explorativeNameForm: "#explorative-name-form",
      explorativeNameInput: "#explorative-name-input",
    };

    this.prototype.behaviors = {
      HoverShowHide: {
        behaviorClass: HoverShowHide,
      },
    };
  }


  submitForm() {
    return this.ui.explorativeNameForm.submit();
  }


  nameExplorativeAnnotation(event) {
    event.preventDefault();
    const target = $(event.target);
    const url = target.attr("action");

    return Request.sendUrlEncodedFormReceiveJSON(
      url,
      { data: target },
    ).then((response) => {
      Toast.message(response.messages);
      const newName = this.$("input[name='name']").val();
      this.model.set("name", newName);
      return this.render();
    },
    );
  }

  toggleState(state) {
    return state.isFinished = !state.isFinished;
  }


  finishOrOpenTracing(event) {
    event.preventDefault();
    const url = $(event.target).attr("href") || $(event.target.parentElement).attr("href");

    return Request.receiveJSON(url).then((response) => {
      Toast.message(response.messages);
      this.toggleState(this.model.attributes.state);
      this.model.collection.remove(this.model);
      return this.options.parent.render();
    },
    );
  }
}
ExplorativeTracingListItemView.initClass();

export default ExplorativeTracingListItemView;
