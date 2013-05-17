package controllers.admin

import akka.actor.actorRef2Scala
import oxalis.mail.DefaultMails
import braingames.mail.Send
import oxalis.security.AuthenticatedRequest
import oxalis.security.Secured
import controllers._
import models.security._
import models.user.TimeTracking
import models.user.User
import models.user.Experience
import play.api.i18n.Messages
import views.html
import net.liftweb.common._
import braingames.mvc.Controller
import braingames.util.ExtendedTypes.ExtendedString
import models.tracing.Tracing
import models.tracing.TracingType
import braingames.binary.models.DataSet

object UserTracingAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  def reopen(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      task <- tracing.task ?~ Messages("task.notFound")
    } yield {
      TaskAdministration.reopenTracing(tracing) match {
        case Some(updated) =>
          JsonOk(html.admin.user.taskTracingTableItem(task, updated), Messages("tracing.reopened"))
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
      JsonOk(html.admin.user.taskTracingTableItem(task, updated), Messages("tracing.finished"))
    }
  }
  
  def reset(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      task <- tracing.task ?~ Messages("task.notFound")
    } yield {
      Tracing.resetToBase(tracing) match {
        case Some(updated) => 
          JsonOk(html.admin.user.taskTracingTableItem(task, updated), Messages("tracing.reset.success"))
        case _       => 
          JsonBadRequest(Messages("tracing.reset.failed"))
      }
    }
  }


  def show(userId: String) = Authenticated { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      val tracings = Tracing.findFor(user).filter(t => !TracingType.isSystemTracing(t))
      val (taskTracings, allExplorationalTracings) =
        tracings.partition(_.tracingType == TracingType.Task)

      val explorationalTracings =
        allExplorationalTracings
          .filter(!_.state.isFinished)
          .sortBy(-_.timestamp)

      val userTasks = taskTracings.flatMap(e => e.task.map(_ -> e))

      val loggedTime = TimeTracking.loggedTime(user)

      Ok(html.admin.user.userTracingAdministration(
        user,
        explorationalTracings,
        userTasks,
        loggedTime))
    }
  }
}