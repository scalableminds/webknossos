/**
 * dataset_list_item_view.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import TemplateHelpers from "libs/template_helpers";
import DatasetAccesslistCollection from "admin/models/dataset/dataset_accesslist_collection";
import DatasetAccessView from "dashboard/views/dataset/dataset_access_view";

class DatasetListItemView extends Marionette.CompositeView {
  importUrl: string;

  static initClass() {
    this.prototype.tagName = "tbody";

    this.prototype.template = _.template(`\
<tr class="dataset-row">
  <td class="details-toggle" href="#">
    <i class="caret-right"></i>
    <i class="caret-down"></i>
  </td>
  <td title="<%- dataSource.baseDir %>"><%- name %><br /><span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(dataStore.name) %>"><%- dataStore.name %></span></td>
  <td><%- formattedCreated %></td>
  <td><%- TemplateHelpers.formatTuple(dataSource.scale) %></td>
  <td class="team-label">
    <% _.map(allowedTeams, function(team){ %>
      <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(team) %>">
        <% if(team == owningTeam){%> <i class="fa fa-lock"></i><% }%><%- team %></span>
    <% }) %>
  </td>
  <td>
    <% if(isActive){ %>
      <i class="fa fa-check"></i>
    <% } else { %>
      <i class="fa fa-times"></i>
    <% } %>
  </td>
  <td>
    <% if(isPublic){ %>
      <i class="fa fa-check"></i>
    <% } else{ %>
      <i class="fa fa-times"></i>
    <% } %>
  </td>
  <td>
  <% _.map(dataSource.dataLayers, function(layer){ %>
      <span class="label label-default"><%- layer.category %> - <%- layer.elementClass %></span>
  <% }) %>
  <td class="nowrap">
    <form action="<%- jsRoutes.controllers.AnnotationController.createExplorational().url %>" method="POST">
      <input type="hidden" name="dataSetName" value="<%- name %>" />
      <input type="hidden" name="contentType" id="contentTypeInput" />
    </form>
    <% if(dataSource.dataLayers == null){ %>
      <div>
        <a href="/datasets/<%- name %>/import" class=" import-dataset">
          <i class="fa fa-plus-circle"></i>import
        </a>

        <div class="import-error">
          <span class="text-danger"><%- dataSource.status %></span>
        </div>
      </div>
    <% } %>
    <% if(isActive){ %>
      <div class="dataset-actions">
        <% if(isEditable) { %>
          <a href="/datasets/<%- name %>/edit" title="Edit dataset">
            <i class="fa fa-pencil"></i> edit
          </a>
        <% } %>
        <a href="/datasets/<%- name %>/view" title="View dataset">
          <img src="/assets/images/eye.svg"> view
        </a>
        <a href="#" title="Create skeleton tracing" id="skeletonTraceLink">
          <img src="/assets/images/skeleton.svg"> start Skeleton Tracing
        </a>
        <% if(dataStore.typ != "ndstore"){ %>
          <a href="#" title="Create volume tracing" id="volumeTraceLink">
            <img src="/assets/images/volume.svg"> start Volume Tracing
          </a>
        <% } %>
      </div>
    <% } %>
  </td>
</tr>
<tr class="details-row hide" >
  <td colspan="13">
    <table class="table table-condensed table-nohead table-hover">
      <thead>
        <tr>
          <th>Users with Access Rights</th>
        </tr>
      </thead>
      <tbody>
      </tbody>
    </table>
  </td>
</tr>\
`);

    this.prototype.childView = DatasetAccessView;
    this.prototype.childViewContainer = "tbody";

    this.prototype.templateContext = { TemplateHelpers };

    this.prototype.events = {
      "click .import-dataset": "startImport",
      "click .details-toggle": "toggleDetails",
      "click #skeletonTraceLink": "startSkeletonTracing",
      "click #volumeTraceLink": "startVolumeTracing",
    };

    this.prototype.ui = {
      row: ".dataset-row",
      detailsToggle: ".details-toggle",
      detailsRow: ".details-row",
      form: "form",
      contentTypeInput: "#contentTypeInput",
    };

    this.prototype.attributes = function attributes() {
      return { "data-dataset-name": this.model.get("name") };
    };
  }

  initialize() {
    this.listenTo(this.model, "change", this.render);
    this.listenTo(app.vent, "datasetListView:toggleDetails", this.toggleDetails);

    this.collection = new DatasetAccesslistCollection(this.model.get("name"));
  }

  toggleDetails() {
    if (this.ui.detailsRow.hasClass("hide")) {
      return this.collection.fetch().then(() => {
        this.render();
        this.ui.detailsRow.removeClass("hide");
        return this.ui.detailsToggle.addClass("open");
      });
    } else {
      this.ui.detailsRow.addClass("hide");
      return this.ui.detailsToggle.removeClass("open");
    }
  }

  startSkeletonTracing(event) {
    return this.submitForm("skeletonTracing", event);
  }

  startVolumeTracing(event) {
    return this.submitForm("volumeTracing", event);
  }

  submitForm(type, event) {
    event.preventDefault();
    this.ui.contentTypeInput.val(type);
    return this.ui.form.submit();
  }
}
DatasetListItemView.initClass();

export default DatasetListItemView;
