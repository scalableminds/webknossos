### define
underscore : _
backbone.marionette : marionette
###

class AchievementView extends Backbone.Marionette.ItemView

  template : _.template("""
    <h3>Achievements</h3>
    <table class="table">
      <tbod>
        <tr>
          <td>Number of Annotations</td>
          <td><%= numberOfAnnotations %></td>
        </tr>
        <tr>
          <td>Number of Users</td>
          <td><%= numberOfUsers %></td>
        </tr>
        <tr>
          <td>Number of open Assignments</td>
          <td><%= numberOfOpenAssignments %></td>
        </tr>
      </tbody>
    </table>
  """)
