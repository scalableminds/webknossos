_          = require("lodash")
Marionette = require("backbone.marionette")

class AchievementView extends Marionette.View

  template : _.template("""
    <h3>Achievements</h3>
    <table class="table">
      <tbod>
        <tr>
          <td>Number of Users</td>
          <td><%- numberOfUsers %></td>
        </tr>
        <tr>
          <td>Number of Datasets</td>
          <td><%- numberOfDatasets %></td>
        </tr>
        <tr>
          <td>Number of Annotations</td>
          <td><%- numberOfAnnotations %></td>
        </tr>
        <tr>
          <td>Number of Trees</td>
          <td><%- numberOfTrees %></td>
        </tr>
        <tr>
          <td>Number of open Assignments</td>
          <td><%= numberOfOpenAssignments %></td>
        </tr>
      </tbody>
    </table>
  """)

module.exports = AchievementView
