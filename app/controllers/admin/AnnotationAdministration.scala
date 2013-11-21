package controllers.admin

import oxalis.security.Secured
import models.security.{RoleDAO, Role}
import models.task.{TaskDAO, Task}
import play.api.i18n.Messages
import play.api.templates.Html
import views.html
import controllers.{Controller, AnnotationController, TracingController}
import models.annotation.{AnnotationService, Annotation, AnnotationType, AnnotationDAO}
import models.user.{UsedAnnotationDAO, UsedAnnotation}
import play.api.libs.concurrent.Execution.Implicits._
import scala.async.Async._
import net.liftweb.common.Full

object AnnotationAdministration extends AdminController {

  def annotationsForTask(taskId: String) = Authenticated().async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
    } yield {
      JsonOk(task.annotations.foldLeft(Html.empty) {
        case (h, e) =>
          h += html.admin.annotation.simpleAnnotation(e)
      })
    }
  }

  def cancel(annotationId: String) = Authenticated().async { implicit request =>
    def tryToCancel(annotation: Annotation) = async {
      annotation match {
        case t if t.typ == AnnotationType.Task =>
          await(AnnotationService.cancelTask(annotation).futureBox).map { _ =>
            JsonOk(Messages("task.cancelled"))
          }
        case _ =>
          Full(JsonOk(Messages("annotation.finished")))
      }
    }
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      result <- tryToCancel(annotation)
    } yield {
      UsedAnnotationDAO.removeAll(annotation.id)
      result
    }
  }

  def reopenAnnotation(annotation: Annotation): Option[Annotation] = {
    if (annotation.typ == AnnotationType.Task)
      Some(annotation.update(_.reopen))
    else
      None
  }

  def reopen(annotationId: String) = Authenticated().async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      task <- annotation.task ?~> Messages("task.notFound")
    } yield {
      reopenAnnotation(annotation) match {
        case Some(updated) =>
          JsonOk(html.admin.annotation.simpleAnnotation(updated), Messages("annotation.reopened"))
        case _ =>
          JsonOk(Messages("annotation.invalid"))
      }
    }
  }

  def finish(annotationId: String) = Authenticated().async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      task <- annotation.task ?~> Messages("task.notFound")
      (updated, message) <- AnnotationService.finishAnnotation(request.user, annotation)
    } yield {
      JsonOk(html.admin.annotation.extendedAnnotation(task, updated), Messages("annotation.finished"))
    }
  }

  def reset(annotationId: String) = Authenticated().async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      task <- annotation.task ?~> Messages("task.notFound")
      resetted <- AnnotationDAO.resetToBase(annotation) ?~> Messages("annotation.reset.failed")
    } yield {
      JsonOk(html.admin.annotation.extendedAnnotation(task, resetted), Messages("annotation.reset.success"))
    }
  }
}