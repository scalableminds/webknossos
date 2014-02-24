### define
underscore : _
backbone.marionette : marionette
###

class DatasetListItemView extends Backbone.Marionette.ItemView


  tagName : "tr"
  template : _.template("""
    <td><%= name %></td>
    <td><%= dataSource.baseDir %></td>
    <td>(
      <%= dataSource.scale[0] %>,
      <%= dataSource.scale[1] %>,
      <%= dataSource.scale[2] %>
    )
    </td>
    <td><%= owningTeam %></td>
    <td class="team-label">
      <% _.map(allowedTeams, function(team){ %>
        <span class="label"><%= team %></span>
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
        <span class="label"><%= layer.typ %> - <%= layer.elementClass %></span>
    <% }) %>
    <td class="nowrap">
      <% if(!dataSource){ %>
      <div class="import-container">
        <a href="/api/datasets/<%= name %>/import" class=" import-dataset">
          <i class="fa fa-plus-circle"></i>import
      </div>
      <% } %>
      <% if(isActive){ %>
        <a href="/datasets/<%= name %>/view" >
          <i class="fa fa-eye"></i>view
        </a>
      <% } %>
    </td>
  """)

  events :
    "click .btn-primary" : "submitTeams"
    "click .team-label" : "loadTeams"
    "click .import-dataset" : "startImport"

  ui :
    "modal" : ".modal"
    "importContainer" : ".import-container"

  initialize : ->

    @teamsCache = null


  loadTeams : (evt) ->

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

      checked = if _.contains(@model.get("allowedTeams"), team.name) then "checked" else ""
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
    assignedTeams = _.map($checkboxes, (checkbox) -> return $(checkbox).parent().text().trim())

    console.log dataset, assignedTeams
    @ui.modal.modal("hide")
    $.ajax(
      url: """/api/datasets/#{@model.get("name")}/teams"""
      type: "POST"
      contentType: "application/json; charset=utf-8"
      data: JSON.stringify(assignedTeams)
    ).done( =>
      @render()
    )


  startImport : (evt) ->

    evt.preventDefault()

    $.ajax(
      url : """/api/datasets/#{@model.get("name")}/import"""
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

    $.ajax(
      url: "/api/datasets/#{@model.get("name")}/import"
    ).done( (value) =>
      value *= 100
      @ui.importContainer.find("bar").width("#{value}%")
      if value < 100
        window.timeout((=> @updateProgress()), 1000)
    )