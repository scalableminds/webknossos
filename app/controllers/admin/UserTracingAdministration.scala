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
import braingames.binary.models.DataSet
import models.annotation.{AnnotationType, AnnotationDAO}
import models.tracing.skeleton.Tracing

object UserTracingAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  def reopen(annotationId: String) = Authenticated { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
      task <- annotation.task ?~ Messages("task.notFound")
    } yield {
      TaskAdministration.reopenAnnotation(annotation) match {
        case Some(updated) =>
          JsonOk(html.admin.user.taskAnnotationTableItem(task, updated), Messages("annotation.reopened"))
        case _ =>
          JsonOk(Messages("annotation.invalid"))
      }
    }
  }

  def finish(annotationId: String) = Authenticated { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
      task <- annotation.task ?~ Messages("task.notFound")
      (updated, message) <- AnnotationController.finishAnnotation(request.user, annotation)
    } yield {
      JsonOk(html.admin.user.taskAnnotationTableItem(task, updated), Messages("annotation.finished"))
    }
  }
  
  def reset(annotationId: String) = Authenticated { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
      task <- annotation.task ?~ Messages("task.notFound")
    } yield {
      AnnotationDAO.resetToBase(annotation) match {
        case Some(updated) => 
          JsonOk(html.admin.user.taskAnnotationTableItem(task, updated), Messages("annotation.reset.success"))
        case _       => 
          JsonBadRequest(Messages("annotation.reset.failed"))
      }
    }
  }


  def show(userId: String) = Authenticated { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      val annotations = AnnotationDAO.findFor(user).filter(t => !AnnotationType.isSystemTracing(t))
      val (taskTracings, allExplorationalAnnotations) =
        annotations.partition(_.typ == AnnotationType.Task)

      val explorationalAnnotations =
        allExplorationalAnnotations
          .filter(!_.state.isFinished)
          .sortBy(a => - a.content.map(_.timestamp).getOrElse(0L))

      val userTasks = taskTracings.flatMap(e => e.task.map(_ -> e))

      val loggedTime = TimeTracking.loggedTime(user)

      Ok(html.admin.user.userTracingAdministration(
        user,
        explorationalAnnotations,
        userTasks,
        loggedTime))
    }
  }
}