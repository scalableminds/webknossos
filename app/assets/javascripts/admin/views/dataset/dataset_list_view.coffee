### define
underscore : _
backbone.marionette : marionette
###

########## SOS #############
########## PLEASE REFACTOR ME AS A REAL MARIONETTE VIEW ###########

class DatasetListView extends Backbone.Marionette.View


  events :
    "click .btn-primary" : "submitTeams"
    "click .team-label" : "loadTeams"

  ui :
    "modal" : ".modal"


  initialize : ->

    @bindUIElements() #Backbone.Marionette internal method
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