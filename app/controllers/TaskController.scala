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
import play.api.libs.concurrent.execution.defaultContext
import play.api.i18n.Messages

object TaskController extends Controller with Secured {
  
  def createTracing(user: User, task: Task) = {
    val tracing = Tracing.createTracingFor(user, task)
    task.update(_.addTracing(tracing))
    tracing
  }

  def request = Authenticated { implicit request =>
    Async {
      val user = request.user
      if (!Tracing.hasOpenTracing(request.user, true)) {
        Task.nextTaskForUser(request.user).asPromise.map {
          case Some(task) =>
            val tracing = createTracing(user, task)
            AjaxOk.success(html.user.dashboard.taskTracingTableItem(task, tracing), Messages("task.new"))
          case _ =>
            Training.findAllFor(user).headOption.map { task =>
              val tracing = createTracing(user, task)
              AjaxOk.success(html.user.dashboard.taskTracingTableItem(task, tracing), Messages("training.new"))
            } getOrElse AjaxBadRequest.error(Messages("task.unavailable"))
        }
      } else
        Promise.pure(AjaxBadRequest.error(Messages("task.alreadyHasOpenOne")))
    }
  }
}