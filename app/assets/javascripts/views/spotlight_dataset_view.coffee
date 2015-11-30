### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
libs/template_helpers : TemplateHelpers
###

class SpotlightDatasetView extends Backbone.Marionette.ItemView

  className : "dataset panel panel-default"

  template : _.template("""
    <div class="panel-body row">
      <div class="dataset-thumbnail col-sm-4">
        <img class="img-rounded" src="<%= thumbnailURL %>">

        <div class="link-row">
          <a href="/datasets/<%= name %>/view" title="View dataset">
            <img src="/assets/images/eye.svg">
          </a>
          <a href="#" title="Create skeleton tracing" id="skeletonTraceLink">
            <img src="/assets/images/skeleton.svg">
          </a>
          <a href="#" title="Create volume tracing" id="volumeTraceLink">
            <img src="/assets/images/volume.svg">
          </a>
        </div>
      </div>

      <form action="<%= jsRoutes.controllers.AnnotationController.createExplorational().url %>" method="POST">
        <input type="hidden" name="dataSetName" value="<%= name %>" />
        <input type="hidden" name="contentType" id="contentTypeInput" />
      </form>

      <div class="dataset-description col-sm-8">
        <h3><%= name %></h3>

        <p><h4><%= owningTeam %></h4></p>
        <p>Scale: <%= TemplateHelpers.formatScale(dataSource.scale) %></p>
        <% if(description) { %>
          <p><%= description %></p>
        <% } else { %>
          <% if(hasSegmentation) { %>
            <p>Original data and segmentation</p>
          <% } else { %>
            <p>Original data</p>
          <% } %>
        <% } %>
      </div>
    </div>
  """)

  templateHelpers :
    TemplateHelpers : TemplateHelpers

  ui:
    skeletonTraceLink : "#skeletonTraceLink"
    volumeTraceLink : "#volumeTraceLink"
    form : "form"
    contentTypeInput : "#contentTypeInput"

  onShow : ->

    @$(".link-row > a").tooltip(placement : "bottom")

    @ui.skeletonTraceLink.click(@submitForm.bind(@, "skeletonTracing"))
    @ui.volumeTraceLink.click(@submitForm.bind(@, "volumeTracing"))


  submitForm : (type, event) ->

    event.preventDefault()
    @ui.contentTypeInput.val(type)
    @ui.form.submit()
