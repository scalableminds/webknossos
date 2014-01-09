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
import scala.concurrent.Future

object AnnotationAdministration extends AdminController {

  def annotationsForTask(taskId: String) = Authenticated().async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      annotations <- task.annotations
      users <- Future.traverse(annotations)(_.user)
      contents <- Future.traverse(annotations)(_.content.futureBox)
      val zipped = (annotations, users, contents).zipped.toList
    } yield {
      JsonOk(zipped.foldLeft(Html.empty) {
        case (h, (a, u, c)) =>
          h += html.admin.annotation.simpleAnnotation(a, u, c)
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

  def reopen(annotationId: String) = Authenticated().async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      task <- annotation.task ?~> Messages("task.notFound")
      reopenedAnnotation <- AnnotationService.reopen(annotation) ?~> Messages("annotation.invalid")
      user <- reopenedAnnotation.user
      content <- reopenedAnnotation.content.futureBox
    } yield {
      JsonOk(html.admin.annotation.simpleAnnotation(reopenedAnnotation, user, content), Messages("annotation.reopened"))
    }
  }

  def finish(annotationId: String) = Authenticated().async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      task <- annotation.task ?~> Messages("task.notFound")
      (updated, message) <- AnnotationService.finishAnnotation(request.user, annotation)
      taskType <- task.taskType.futureBox
      project <- task.project.futureBox

      dataSetName <- annotation.dataSetName
      stats <- models.annotation.AnnotationDAO.statisticsForAnnotation(annotation).futureBox
      content <- annotation.content.futureBox
    } yield {
      JsonOk(
        html.admin.annotation.extendedAnnotation(task, updated, taskType, project, dataSetName, stats.toOption, content),
        Messages("annotation.finished"))
    }
  }

  def reset(annotationId: String) = Authenticated().async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
      task <- annotation.task ?~> Messages("task.notFound")
      resetted <- AnnotationService.resetToBase(annotation) ?~> Messages("annotation.reset.failed")
      taskType <- task.taskType.futureBox
      project <- task.project.futureBox

      dataSetName <- annotation.dataSetName
      stats <- models.annotation.AnnotationDAO.statisticsForAnnotation(annotation).futureBox
      content <- annotation.content.futureBox

    } yield {
      JsonOk(
        html.admin.annotation.extendedAnnotation(task, resetted, taskType, project, dataSetName, stats.toOption, content),
        Messages("annotation.reset.success"))


    }
  }
}