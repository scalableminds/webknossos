### define
underscore : _
app : app
backbone.marionette : marionette
libs/toast : Toast
libs/template_helpers : TemplateHelpers
libs/request : Request
admin/models/dataset/dataset_accesslist_collection : DatasetAccesslistCollection
./dataset_access_view : DatasetAccessView
###

class DatasetListItemView extends Backbone.Marionette.CompositeView


  tagName : "tbody"
  attributes : ->
    "data-dataset-name" : @model.get("name")

  template : _.template("""
    <tr>
      <td class="details-toggle" href="#">
        <i class="caret-right"></i>
        <i class="caret-down"></i>
      </td>
      <td title="<%= dataSource.baseDir %>"><%= name %></td>
      <td><%= dataStore.name %></td>
      <td><%= TemplateHelpers.formatScale(dataSource.scale) %></td>
      <td><%= owningTeam %></td>
      <td class="team-label">
        <% _.map(allowedTeams, function(team){ %>
          <span class="label label-default" style="background-color: <%= TemplateHelpers.stringToColor(team) %>"><%= team %></span>
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
          <span class="label label-default"><%= layer.category %> - <%= layer.elementClass %></span>
      <% }) %>
      <td class="nowrap">
        <form action="<%= jsRoutes.controllers.AnnotationController.createExplorational().url %>" method="POST">
          <input type="hidden" name="dataSetName" value="<%= name %>" />
          <input type="hidden" name="contentType" id="contentTypeInput" />
        </form>
        <% if(dataSource.needsImport){ %>
          <div>
            <a href="/api/datasets/<%= name %>/import" class=" import-dataset">
              <i class="fa fa-plus-circle"></i>import
            </a>
              <div class="progress progress-striped hide">
                <div class="progress-bar" style="width: 0%;"></div>
              </div>
          </div>
        <% } %>
        <% if(isActive){ %>
          <div class="dataset-actions">
            <a href="/datasets/<%= name %>/view" title="View dataset">
              <img src="/assets/images/eye.svg"> view
            </a>
            <a href="#" title="Create skeleton tracing" id="skeletonTraceLink">
              <img src="/assets/images/skeleton.svg"> start Skeleton Tracing
            </a>
            <a href="#" title="Create volume tracing" id="volumeTraceLink">
              <img src="/assets/images/volume.svg"> start Volume Tracing
            </a>
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
    </tr>
  """)

  childView : DatasetAccessView
  childViewContainer : "tbody"

  templateHelpers :
    TemplateHelpers : TemplateHelpers

  events :
    "click .import-dataset" : "startImport"
    "click .details-toggle" : "toggleDetails"
    "click #skeletonTraceLink" : "startSkeletonTracing"
    "click #volumeTraceLink" : "startVolumeTracing"


  ui:
    "importLink" : ".import-dataset"
    "progressbarContainer" : ".progress"
    "progressBar" : ".progress-bar"
    "detailsToggle" : ".details-toggle"
    "detailsRow" : ".details-row"
    "form" : "form"
    "contentTypeInput" : "#contentTypeInput"


  initialize : ->

    @listenTo(@model, "change", @render)
    @listenTo(app.vent, "datasetListView:toggleDetails", @toggleDetails)

    @importUrl = "/api/datasets/#{@model.get("name")}/import"
    @collection = new DatasetAccesslistCollection(@model.get("name"))

    # In case the user reloads during an import, continue the progress bar
    @listenToOnce(@, "render", ->
      if @model.get("dataSource").needsImport
        @startImport(null, "GET")
    )


   startImport : (evt, method = "POST") ->

      if evt
        evt.preventDefault()

      Request.json(
        @importUrl
        method: method
      ).then( (responseJSON) =>
          if responseJSON.status == "inProgress"
            @ui.importLink.hide()
            @ui.progressbarContainer.removeClass("hide")
            @updateProgress()
      )


    updateProgress : ->

      Request
        .json(@importUrl)
        .then( (responseJSON) =>
          value = responseJSON.progress * 100
          if value
            @ui.progressBar.width("#{value}%")

          switch responseJSON.status
            when "finished"
              @model.fetch()
              Toast.message(responseJSON.messages)
            when "notStarted", "inProgress"
              window.setTimeout((=> @updateProgress()), 100)
            when "failed"
              @ui.importLink.show()
              @ui.progressbarContainer.addClass("hide")
              # TODO: color table row which contains error
              # TODO: insert error message in import-link cell
        )


  toggleDetails : ->

    if @ui.detailsRow.hasClass("hide")

      @collection
        .fetch()
        .done( =>
          @render()
          @ui.detailsRow.removeClass("hide")
          @ui.detailsToggle.addClass("open")
        )
    else
      @ui.detailsRow.addClass("hide")
      @ui.detailsToggle.removeClass("open")


  startSkeletonTracing : (event) ->

    @submitForm("skeletonTracing", event)


  startVolumeTracing : (event) ->

    @submitForm("volumeTracing", event)


  submitForm : (type, event) ->

    event.preventDefault()
    @ui.contentTypeInput.val(type)
    @ui.form.submit()
