### define
underscore : _
app : app
backbone.marionette : marionette
###

class DashboardTaskListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"

  template : _.template("""
    <td><%= tasks.formattedHash %> </td>
    <td><% if(tasks.type){ print(tasks.type.summary) } else { print("<deleted>") } + " - " + annotation.typ %></td>
    <td><%= tasks.projectName %> </td>
    <td><% if(tasks.type){ print(tasks.type.description) } else { print("") } %></td>
    <td>
      <span class="label"> <% if(tasks.type){ print(tasks.type.settings.allowedModes) } else { print("")} %></span>
    </td>
    <td class="nowrap">
      <% if (annotation.state.isFinished) { %>
        <i class="fa fa-check"></i><span> Finished</span><br />
      <% } else { %>
        <a href="/annotation/<%= annotation.typ %>/<%= annotation.id %>"><i class="fa fa-random"></i>trace</a><br/>
        <a href="/annotation/<%= annotation.typ %>/<%= annotation.id %>/finish" class="trace-finish" data-ajax="replace-row,confirm=@Messages("annotation.finish.confirm")" ><i class="fa fa-check-circle-o"></i>finish</a>
      <% } %>
    </td>
  """)

  className : ->

    if @model.get("annotation").state.isFinished
      return "finished"
    else
      return "unfinished"
