package controllers.admin

import oxalis.security.Secured
import braingames.mvc.Controller
import models.security.Role
import models.task.Task
import play.api.i18n.Messages
import play.api.templates.Html
import views.html
import controllers.{AnnotationController, TracingController}
import models.annotation.{Annotation, AnnotationType, AnnotationDAO}
import models.user.UsedAnnotation

object AnnotationAdministration extends Controller with Secured {
  override val DefaultAccessRole = Role.Admin

  def annotationsForTask(taskId: String) = Authenticated { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
    } yield {
      Ok(task.annotations.foldLeft(Html.empty) {
        case (h, e) =>
          h += html.admin.annotation.simpleAnnotation(e)
      })
    }
  }

  def cancel(annotationId: String) = Authenticated{
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
      } yield {
        UsedAnnotation.removeAll(annotation.id)
        annotation match {
          case t if t.typ == AnnotationType.Task =>
            annotation.update(_.cancel)
            JsonOk(Messages("task.cancelled"))
        }
      }
  }

  def reopenAnnotation(annotation: Annotation): Option[Annotation] = {
    if (annotation.typ == AnnotationType.Task)
      Some(annotation.update(_.reopen))
    else
      None
  }

  def reopen(annotationId: String) = Authenticated {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
        task <- annotation.task ?~ Messages("task.notFound")
      } yield {
        reopenAnnotation(annotation) match {
          case Some(updated) =>
            JsonOk(html.admin.annotation.simpleAnnotation(updated), Messages("annotation.reopened"))
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
      JsonOk(html.admin.annotation.extendedAnnotation(task, updated), Messages("annotation.finished"))
    }
  }
  
  def reset(annotationId: String) = Authenticated { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
      task <- annotation.task ?~ Messages("task.notFound")
    } yield {
      AnnotationDAO.resetToBase(annotation) match {
        case Some(updated) => 
          JsonOk(html.admin.annotation.extendedAnnotation(task, updated), Messages("annotation.reset.success"))
        case _       => 
          JsonBadRequest(Messages("annotation.reset.failed"))
      }
    }
  }
}