### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/explorative_tracing_list_item_view : ExplorativeTracingListItemView
libs/input : Input
libs/toast : Toast
libs/behaviors/sort_table_behavior : SortTableBehavior
###

class ExplorativeTracingListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Explorative Annotations</h3>
    <% if (!isAdminView) {%>
      <div>
        <form action="<%= jsRoutes.controllers.admin.NMLIO.upload().url %>"
          method="POST"
          enctype="multipart/form-data"
          id="upload-and-explore-form"
          class="form-inline inline-block">
          <span class="btn-file btn btn-default">
            <input type="file" name="nmlFile" multiple>
              <i class="fa fa-upload" id="form-upload-icon"></i>
              <i class="fa fa-spinner fa-spin hide" id="form-spinner-icon"></i>
              Upload NML & explore
            </input>
          </span>
        </form>

        <div class="divider-vertical"></div>

        <form action="<%= jsRoutes.controllers.AnnotationController.createExplorational().url %>"
          method="POST"
          class="form-inline inline-block">
          <select id="dataSetsSelect" name="dataSetName" class="form-control">
            <% activeDataSets.forEach(function(d) { %>
              <option value="<%= d.get("name") %>"> <%= d.get("name") %> </option>
            <% }) %>
          </select>
          <button type="submit" class="btn btn-default" name="contentType" value="skeletonTracing">
            <i class="fa fa-search"></i>Open skeleton mode
          </button>
          <button type="submit" class="btn btn-default" name="contentType" value="volumeTracing">
            <i class="fa fa-search"></i>Open volume mode
          </button>
        </form>
      </div>
    <% } %>

    <table class="table table-striped table-hover sortable-table" id="explorative-tasks">
      <thead>
        <tr>
          <th data-sort="formattedHash"> # </th>
          <th data-sort="name"> Name </th>
          <th data-sort="dataSource.id"> DataSet </th>
          <th> Stats </th>
          <th> Type </th>
          <th data-sort="created"> Created </th>
          <th> </th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  """)

  childView : ExplorativeTracingListItemView
  childViewContainer : "tbody"

  events :
    "change input[type=file]" : "selectFiles"
    "submit @ui.uploadAndExploreForm" : "uploadFiles"

  ui :
    tracingChooser : "#tracing-chooser"
    uploadAndExploreForm : "#upload-and-explore-form"
    formSpinnerIcon : "#form-spinner-icon"
    formUploadIcon : "#form-upload-icon"

  templateHelpers : ->
    activeDataSets : @datasetCollection.toArray()

  behaviors :
    SortTableBehavior :
      behaviorClass : SortTableBehavior


  initialize : (options) ->

    @collection = @model.get("exploratoryAnnotations")

    @datasetCollection = @model.get("dataSets")
    @listenTo(@datasetCollection, "sync", @render)
    @datasetCollection.fetch({silent : true, data : "isActive=true"})


  selectFiles : (event) ->

    if event.target.files.length
      @ui.uploadAndExploreForm.submit()


  uploadFiles : (event) ->

    event.preventDefault()

    toggleIcon = =>

      [@ui.formSpinnerIcon, @ui.formUploadIcon].forEach((ea) -> ea.toggleClass("hide"))


    toggleIcon()

    form = @ui.uploadAndExploreForm

    $.ajax(
      url : form.attr("action")
      data : new FormData(form[0])
      type : "POST"
      processData : false
      contentType : false
    ).done( (data) ->
      url = "/annotations/" + data.annotation.typ + "/" + data.annotation.id
      app.router.loadURL(url)
      Toast.message(data.messages)
    ).fail( (xhr) ->
      Toast.message(xhr.responseJSON.messages)
    ).always( ->
      toggleIcon()
    )
