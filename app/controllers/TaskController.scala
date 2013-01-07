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
        Task.nextTaskForUser(request.user).map {
          case Some(task) =>
            val tracing = createTracing(user, task)
            JsonOk(html.user.dashboard.taskTracingTableItem(task, tracing), Messages("task.assigned"))
          case _ =>
            for{
              task <- Training.findAllFor(user).headOption ?~ Messages("task.unavailable")
            } yield {
              val tracing = createTracing(user, task)
              JsonOk(html.user.dashboard.taskTracingTableItem(task, tracing), Messages("task.training.assigned"))
            } 
        }
      } else
        Promise.pure(JsonBadRequest(Messages("task.alreadyHasOpenOne")))
    }
  }
}