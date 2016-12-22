_          = require("lodash")
Marionette = require("backbone.marionette")
Request    = require("libs/request")

class TaskQueryDocumentationModal extends Marionette.View

  tagName : "div"
  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Task Query Documentation</h3>
        </div>
        <div class="modal-body form-horizontal">
          <h3>Links</h3>
          <ul>
            <li>
              <a href="https://docs.mongodb.com/manual/reference/mongodb-extended-json/">
                JSON specifics
              </a>
            </li>
            <li>
              <a href="https://docs.mongodb.com/manual/reference/operator/query/">
                Available operators
              </a>
            </li>
          </ul>

          <h3>Available Task Properties</h3>
          <div id="properties" />
        </div>
      </div>
    </div>
  """)

  ui :
    properties : "#properties"

  onRender : ->
    Request.receiveJSON("api/descriptions/task").then((descriptions) =>

      tableHtml = _.template(
        """
          <table style="width: 100%">
            <thead>
              <tr>
                <th>Property name</th>
                <th>Type</th>
                <th>Info</th>
              </tr>
            </thead>
            <tbody>
              <% _.each(descriptions ,function(item, key){ %>
                <tr>
                  <td><%= item.name %></td>
                  <td><%= item.typ %></td>
                  <td><%= item.info %></td>
                </tr>
              <% }) %>
            </tbody>
          </table>
        """
      )({descriptions : descriptions})

      @ui.properties.html(tableHtml)
    )


module.exports = TaskQueryDocumentationModal
