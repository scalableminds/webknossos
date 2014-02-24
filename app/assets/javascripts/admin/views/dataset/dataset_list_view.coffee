### define
underscore : _
backbone.marionette : marionette
./dataset_list_item_view : marionette
###

class DatasetListView extends Backbone.Marionette.CompositeView

  className : "dataset-administration container wide"
  template : _.template("""
      <h3>DataSets</h3>
      <table class="table table-striped" id="dataSet-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Base Dir</th>
            <th>Scale</th>
            <th>Owning Team</th>
            <th>Allowed Teams</th>
            <th>Active</th>
            <th>Public</th>
            <th>Data Layers</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
        </tbody>
      </table>
      <div class="modal hide fade">
        <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h3>Assign teams for this dataset</h3>
        </div>
        <div class="modal-body">
          <ul name="teams" class="modal-team-list"></ul>
        </div>
        <div class="modal-footer">
          <a class="btn btn-primary">Save</a>
          <a href="#" class="btn" data-dismiss="modal">Cancel</a>
        </div>
      </div>
    </div>
  """)

  events :
    "click .btn-primary" : "submitTeams"
    "click .team-label" : "loadTeams"
    "click .import-dataset" : "startImport"

  ui :
    "modal" : ".modal"
    "importContainer" : ".import-container"

  itemView : DatasetListItemView
  itemViewContainer: "tbody"

  initialize : ->

    @teamsCache = null
    @assignedTeams = []


  loadTeams : (evt) ->

    # Find parent and read all labels for one dataset
    $parent = $(evt.target).closest("tr")
    dataset = $parent.find("td").first().text().trim()
    @ui.modal.data("dataset", dataset)

    $labels = $parent.find(".team-label").find(".label")
    @assignedTeams = _.map($labels, (label) -> return $(label).text())

    if @teamsCache
      @showModal()
    else
      $.ajax(
        url: "/api/teams"
        dataType: "json"
      ).done(
        (responseJSON) =>
          @teamsCache = responseJSON
          @showModal()
      )


  showModal : ->

    $teamList = @ui.modal.find("ul").empty()
    $checkBoxTags = _.map(@teamsCache, (team) =>

      checked = if _.contains(@assignedTeams, team.name) then "checked" else ""
      $("""
        <li>
          <label class="checkbox"><input type="checkbox" value="#{team.name}" #{checked}> #{team.name}</label>
        </li>
      """)
    )
    $teamList.append($checkBoxTags)
    @ui.modal.modal("show")


  submitTeams : ->

    $checkboxes = @ui.modal.find("input:checked")
    dataset = @ui.modal.data("dataset")
    assignedTeams = _.map($checkboxes, (checkbox) -> return $(checkbox).parent().text().trim())

    console.log dataset, assignedTeams
    @ui.modal.modal("hide")
    $.ajax(
      url: "/api/datasets/#{dataset}/teams"
      type: "POST"
      contentType: "application/json; charset=utf-8"
      data: JSON.stringify(assignedTeams)
    ).done( ->
      window.location.reload()
    )


  startImport : (evt) ->

    evt.preventDefault()

    $.ajax(
      url : $(evt.target).prop("href")
      method: "POST"
    ).done( =>
      @ui.importContainer.html("""
        <div class="progress progress-striped">
          <div class="bar" style="width: 0%;"></div>
        </div>
        """)
      @updateProgress()
    )


  updateProgress : ->

    dataset = @ui.modal.data("dataset")
    $.ajax(
      url: "/api/datasets/#{dataset}/import"
    ).done( (value) =>
      value *= 100
      @ui.importContainer.find("bar").width("#{value}%")
      if value < 100
        window.timeout((=> @updateProgress()), 1000)
    )


