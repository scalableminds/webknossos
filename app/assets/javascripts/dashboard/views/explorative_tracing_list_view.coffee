### define
underscore : _
backbone.marionette : marionette
app : app
admin/models/dataset/dataset_collection : DatasetCollection
admin/views/selection_view : SelectionView
dashboard/views/explorative_tracing_list_item_view : ExplorativeTracingListItemView
libs/input : Input
libs/toast : Toast
libs/request : Request
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
          <div class="dataset-selection inline-block"></div>
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

  behaviors :
    SortTableBehavior :
      behaviorClass : SortTableBehavior


  initialize : (options) ->

    @collection = @model.get("exploratoryAnnotations")

    @datasetSelectionView = new SelectionView(
      viewComparator: "name"
      collection : new DatasetCollection()
      name : "dataSetName"
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "isActive=true"
    )

    @datasetRegion = new Marionette.Region(
      el : ".dataset-selection"
    )


  onShow : ->

    @datasetRegion.show(@datasetSelectionView)


  selectFiles : (event) ->

    if event.target.files.length
      @ui.uploadAndExploreForm.submit()


  uploadFiles : (event) ->

    event.preventDefault()

    toggleIcon = (state) =>

      @ui.formSpinnerIcon.toggleClass("hide", state)
      @ui.formUploadIcon.toggleClass("hide", !state)


    toggleIcon(false)

    form = @ui.uploadAndExploreForm

    Request.always(
      Request.multipartForm(
        form.attr("action")
        data : new FormData(form[0])
      ).then((data) ->
        url = "/annotations/" + data.annotation.typ + "/" + data.annotation.id
        app.router.loadURL(url)
        Toast.message(data.messages)
      )
      -> toggleIcon(true)
    )
