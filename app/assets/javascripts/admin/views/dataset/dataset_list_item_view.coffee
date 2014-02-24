### define
underscore : _
backbone.marionette : marionette
###

class DatasetListItemView extends Backbone.Marionette.ItemView


  tagName : "tr"
  template : _.template("""
    <td><%= name %></td>
    <td><%= dataSource.map(_.relativeBaseDir(BinaryDataService.dataSourceRepositoryDir.toAbsolute.path))</td>
    <td>(<%= _.map(datasource.scale, function(scale){ print(scale)}) %>)</td>
    <td><%= owningTeam %></td>
    <td class="team-label">
      <% _.map(allowedTeams, function(team){ %>
        <span class="label"><%= team %></span>
      <% })%>
    </td>
    <td>
      <% if(isActive){ %>
        <i class="fa fa-check"></i>
      <% } else{ %
        <i class="fa fa-times"></i>
      <% } %>
    </td>
    <td>
      <% if(isPublic){ %>
        <i class="fa fa-check"></i>
      <% } else{ %
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