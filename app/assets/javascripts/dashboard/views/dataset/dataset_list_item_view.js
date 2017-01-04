import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import TemplateHelpers from "libs/template_helpers";
import DatasetAccesslistCollection from "admin/models/dataset/dataset_accesslist_collection";
import DatasetAccessView from "./dataset_access_view";
import Request from "libs/request";


class DatasetListItemView extends Marionette.CompositeView {
  static initClass() {


    this.prototype.tagName  = "tbody";

    this.prototype.template  = _.template(`\
<tr class="dataset-row">
  <td class="details-toggle" href="#">
    <i class="caret-right"></i>
    <i class="caret-down"></i>
  </td>
  <td title="<%- dataSource.baseDir %>"><%- name %><br /><span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(dataStore.name) %>"><%- dataStore.name %></span></td>
  <td><%- formattedCreated %></td>
  <td><%- TemplateHelpers.formatScale(dataSource.scale) %></td>
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
    <% if(dataSource.needsImport){ %>
      <div>
        <a href="/api/datasets/<%- name %>/import" class=" import-dataset">
          <i class="fa fa-plus-circle"></i>import
        </a>
        <div class="progress progress-striped hide">
          <div class="progress-bar" style="width: 0%;"></div>
        </div>
        <div class="import-error">
          <span class="text-danger"></span>
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

    this.prototype.childView  = DatasetAccessView;
    this.prototype.childViewContainer  = "tbody";

    this.prototype.templateContext  =
      {TemplateHelpers};

    this.prototype.events  = {
      "click .import-dataset" : "startImport",
      "click .details-toggle" : "toggleDetails",
      "click #skeletonTraceLink" : "startSkeletonTracing",
      "click #volumeTraceLink" : "startVolumeTracing"
    };


    this.prototype.ui = {
      "row" : ".dataset-row",
      "importError" : ".import-error",
      "errorText" : ".import-error .text-danger",
      "importLink" : ".import-dataset",
      "progressbarContainer" : ".progress",
      "progressBar" : ".progress-bar",
      "detailsToggle" : ".details-toggle",
      "detailsRow" : ".details-row",
      "form" : "form",
      "contentTypeInput" : "#contentTypeInput"
    };
  }
  attributes() {
    return {"data-dataset-name" : this.model.get("name")};
  }


  initialize() {

    // by default there is no import error

    this.listenTo(this.model, "change", this.render);
    this.listenTo(app.vent, "datasetListView:toggleDetails", this.toggleDetails);

    this.importUrl = `/api/datasets/${this.model.get("name")}/import`;
    this.collection = new DatasetAccesslistCollection(this.model.get("name"));

    // In case the user reloads during an import, continue the progress bar
    return this.listenToOnce(this, "render", function() {
      if (this.model.get("dataSource").needsImport) {
        return this.startImport(null, "GET");
      }
    });
  }


  startImport(evt, method = "POST") {

    if (evt) {
      evt.preventDefault();
    }

    return Request.receiveJSON(
      this.importUrl,{
      method,
      doNotCatch: true
    }
    )
    .then( responseJSON => {
      if (responseJSON.status === "inProgress") {
        this.ui.row.removeClass('import-failed');
        this.ui.importLink.hide();
        this.ui.progressbarContainer.removeClass("hide");
        this.ui.importError.addClass("hide");
        this.updateProgress();
      }
      if (responseJSON.status === "failed") {
        return this.importFailed(responseJSON);
      }
    }
    )
    .catch( response => {
      return response
        .json()
        .then( json => this.importFailed(json));
    }
    );
  }


  importFailed(response) {

    if (this.isRendered() && !this.isDestroyed()) {
      this.ui.importLink.show();
      this.ui.progressbarContainer.addClass("hide");
      this.ui.row.addClass('import-failed');
      this.ui.importError.removeClass("hide");

      // apply single error
      if (__guard__(__guard__(response.messages, x1 => x1[0]), x => x.error)) {
        return this.ui.errorText.text(response.messages[0].error);
      }
    }
  }


  updateProgress() {

    return Request
      .receiveJSON(this.importUrl)
      .then( responseJSON => {
        const value = responseJSON.progress * 100;
        if (value) {
          this.ui.progressBar.width(`${value}%`);
        }

        switch (responseJSON.status) {
          case "finished":
            this.model.fetch().then(this.render.bind(this));
            return Toast.message(responseJSON.messages);
          case "notStarted": case "inProgress":
            return window.setTimeout((() => this.updateProgress()), 1000);
          case "failed":
            return this.importFailed(responseJSON);
        }
      }
      );
  }

  toggleDetails() {

    if (this.ui.detailsRow.hasClass("hide")) {

      return this.collection
        .fetch()
        .then( () => {
          this.render();
          this.ui.detailsRow.removeClass("hide");
          return this.ui.detailsToggle.addClass("open");
        }
        );
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

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
