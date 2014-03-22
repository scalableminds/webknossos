### define
underscore : _
app : app
backbone.marionette : marionette
routes : routes
###

class ExplorativeTracingListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"
  className : ""
  template : _.template("""

    <td> <%= formattedHash %> </td>
    <td class="explorative-name-column hover-dynamic">
      <span class="hover-hide" id="explorative-tracing-name"> <%= name %> </span>
      <form action="<%= jsRoutes.controllers.AnnotationController.nameExplorativeAnnotation(typ, id).url %>"
        method="POST" data-ajax="submit,replace-row" class="hover-show hide">
        <div class="input-append">
          <input class="input-medium hover-input"
                 name="name"
                 id="explorative-name-input"
                 maxlength="50"
                 type="text"
                 value="<%= name %>"
                 autocomplete="off">
            <a href="<%= jsRoutes.controllers.AnnotationController.nameExplorativeAnnotation(typ, id).url %>"
              data-ajax="submit,replace-row" id="explorative-name-submit" class="btn"><i class="fa fa-check"></i></a>
        </div>
      </form>
    </td>
    <td> <%= dataSetName || "" %> </td>

    <td>
      <% if (stats) { %>
        <span title="Trees"><i class="fa fa-sitemap"></i><%= stats.numberOfTrees %> &nbsp;</span><br />
        <span title="Nodes"><i class="fa fa-bull"></i><%= stats.numberOfNodes %> &nbsp;</span><br />
        <span title="Edges"><i class="fa fa-arrows-h"></i><%= stats.numberOfEdges %></span>
      <% } %>
    </td>

    <td> <%= contentType + " - " + typ %> </td>
    <td> <%= created %> </td>
    <td class="nowrap">
      <a href="<%= jsRoutes.controllers.AnnotationController.trace(typ, id).url %>"><i class="fa fa-random"></i>trace</a><br />
      <a href="<%= jsRoutes.controllers.AnnotationController.download(typ, id).url %>"><i class="fa fa-download"></i>download</a><br />
      <% if (typ == "Explorational"){ %>
        <a href="<%= jsRoutes.controllers.AnnotationController.finish(typ, id).url %>" data-ajax="delete-row,confirm=@Messages("annotation.finish.confirm")"><i class="fa fa-trash-o"></i>delete</a>
      <% } %>
    </td>
  """)
