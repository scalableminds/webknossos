import _ from "lodash";
import Marionette from "backbone.marionette";
import TemplateHelpers from "libs/template_helpers";
import app from "app";

class SpotlightDatasetView extends Marionette.View {
  static initClass() {
    this.prototype.className = "dataset panel panel-default";

    this.prototype.template = _.template(`\
<div class="panel-body row">
  <div class="dataset-thumbnail col-sm-4">
    <img class="img-rounded" src="<%- thumbnailURL %>">

    <div class="link-row">
      <a href="/datasets/<%- name %>/view" title="View dataset">
        <img src="/assets/images/eye.svg">
      </a>
      <a href="#" title="Create skeleton tracing" id="skeletonTraceLink">
        <img src="/assets/images/skeleton.svg">
      </a>
      <% if(dataStore.typ != "ndstore"){ %>
        <a href="#" title="Create volume tracing" id="volumeTraceLink">
          <img src="/assets/images/volume.svg">
        </a>
      <% } %>
    </div>
  </div>

  <form action="<%- jsRoutes.controllers.AnnotationController.createExplorational().url %>" method="POST">
    <input type="hidden" name="dataSetName" value="<%- name %>" />
    <input type="hidden" name="contentType" id="contentTypeInput" />
  </form>

  <div class="dataset-description col-sm-8">
    <h3><%- name %></h3>

    <p>Scale: <%- TemplateHelpers.formatScale(dataSource.scale) %></p>
    <% if(description) { %>
      <p style="white-space: pre-wrap;"><%- description %></p>
    <% } else { %>
      <% if(hasSegmentation) { %>
        <p>Original data and segmentation</p>
      <% } else { %>
        <p>Original data</p>
      <% } %>
    <% } %>
  </div>
</div>\
`);

    this.prototype.templateContext =
      { TemplateHelpers };

    this.prototype.ui = {
      skeletonTraceLink: "#skeletonTraceLink",
      volumeTraceLink: "#volumeTraceLink",
      form: "form",
      contentTypeInput: "#contentTypeInput",
    };
  }


  onRender() {
    this.$(".link-row > a").tooltip({ placement: "bottom" });

    this.ui.skeletonTraceLink.click(this.submitForm.bind(this, "skeletonTracing"));
    return this.ui.volumeTraceLink.click(this.submitForm.bind(this, "volumeTracing"));
  }


  submitForm(type, event) {
    event.preventDefault();
    const loginNotice = `For dataset annotation, please log in or create an account. For dataset viewing, no account is required.
Do you wish to sign up now?`;
    if (app.currentUser != null) {
      this.ui.contentTypeInput.val(type);
      this.ui.form.submit();
    } else if (confirm(loginNotice)) {
      window.location.href = "/auth/register";
    }
  }
}
SpotlightDatasetView.initClass();


export default SpotlightDatasetView;
