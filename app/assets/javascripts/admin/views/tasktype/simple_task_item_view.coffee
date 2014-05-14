### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
###

class SimpleTaskItemView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <tr>
      <td>
        <a href="@controllers.routes.TaskController.empty#@task.id">
          @formatHash(task.id)
        </a>
      </td>
      <td>
        <a href="/admin/taskTypes#@taskType.map(_.id)">
          @taskType.map(_.summary)
        </a>
      </td>
      <td>
        @dataSetName
      </td>
      <td>
        <span title="Unassigned">
          <i class="fa fa-play-circle"></i>@status.open open
        </span>
        |
        <span title="in Progress">
          <i class="fa fa-random"></i>@status.inProgress active
        </span>
        |
        <span title="Completed">
          <i class="fa fa-check-circle-o"></i>@status.completed done
        </span>
      </td>
      <td>
        Tracked Time: @task.tracingTime.map(t => formatTimeHumanReadable(t millis)).getOrElse("-")
      </td>
      <td class="nowrap">
        <a href="@controllers.admin.routes.NMLIO.taskDownload(task.id)" title="download all finished tracings"><i class="fa fa-download"></i>download </a>
      </td>
    </tr>
  """)
