package controllers.admin

import oxalis.security.Secured
import braingames.mvc.Controller
import models.security.Role
import models.task.Task
import models.tracing.Tracing
import models.tracing.TracingType
import play.api.i18n.Messages
import play.api.templates.Html
import views.html
import models.tracing.UsedTracings
import controllers.TracingController

object TracingAdministration extends Controller with Secured {
  override val DefaultAccessRole = Role.Admin

  def tracingsForTask(taskId: String) = Authenticated { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
    } yield {
      Ok(task.tracings.foldLeft(Html.empty) {
        case (h, e) =>
          h += html.admin.tracing.simpleTracing(e)
      })
    }
  }

  def cancelTracing(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
    } yield {
      UsedTracings.removeAll(tracing.id)
      tracing match {
        case t if t.tracingType == TracingType.Task =>
          tracing.update(_.cancel)
          JsonOk(Messages("task.cancelled"))
      }
    }
  }

  def reopen(tracingId: String, extendedResult: Boolean) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      task <- tracing.task ?~ Messages("task.notFound")
    } yield {
      Tracing.reopenTracing(tracing) match {
        case Some(updated) =>
          val result =
            if (extendedResult)
              html.admin.tracing.extendedTracing(task, updated)
            else
              html.admin.tracing.simpleTracing(updated)
          JsonOk(result, Messages("tracing.reopened"))
        case _ =>
          JsonOk(Messages("tracing.invalid"))
      }
    }
  }

  def finish(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      task <- tracing.task ?~ Messages("task.notFound")
      (updated, message) <- TracingController.finishTracing(request.user, tracing)
    } yield {
      JsonOk(html.admin.tracing.extendedTracing(task, updated), Messages("tracing.finished"))
    }
  }

  def reset(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      task <- tracing.task ?~ Messages("task.notFound")
    } yield {
      Tracing.resetToBase(tracing) match {
        case Some(updated) =>
          JsonOk(html.admin.tracing.extendedTracing(task, updated), Messages("tracing.reset.success"))
        case _ =>
          JsonBadRequest(Messages("tracing.reset.failed"))
      }
    }
  }
}