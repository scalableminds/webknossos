package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.security.Role
import models.binary.DataSet
import play.api.Logger
import models.tracing.Tracing
import models.user._
import models.task._
import models.tracing.UsedTracings
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import braingames.mvc.Controller
import models.tracing.TracingType

object TaskController extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def request = Authenticated { implicit request =>
    Async {
      val user = request.user
      if (!Tracing.hasOpenTracing(request.user, TracingType.Task)) {
        Task.nextTaskForUser(request.user).map {
          case Some(task) =>
            for {
              tracing <- Tracing.createTracingFor(user, task) ?~ Messages("tracing.creationFailed")
            } yield {
              JsonOk(html.user.dashboard.taskTracingTableItem(task, tracing), Messages("task.assigned"))
            }
          case _ =>
            for {
              task <- Training.findAssignableFor(user).headOption ?~ Messages("task.unavailable")
              tracing <- Tracing.createTracingFor(user, task) ?~ Messages("tracing.creationFailed")
            } yield {
              JsonOk(html.user.dashboard.taskTracingTableItem(task, tracing), Messages("task.training.assigned"))
            }
        }
      } else
        Promise.pure(JsonBadRequest(Messages("task.alreadyHasOpenOne")))
    }
  }
}