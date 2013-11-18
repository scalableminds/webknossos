package controllers.admin

import oxalis.security.Secured
import models.security.{RoleDAO, Role}
import models.user.{UserService, User}
import play.api.data._
import play.api.data.Forms._
import play.api.i18n.Messages
import controllers.{Controller, Application}
import braingames.mail.Send
import oxalis.mail.DefaultMails
import models.annotation.{AnnotationType, AnnotationDAO}
import models.tracing.skeleton.SkeletonTracing
import views._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._


object TrainingsTracingAdministration extends AdminController {

  val reviewForm = Form(
    single(
      "comment" -> text))

  def startReview(training: String) = Authenticated {
    implicit request =>
      Async {
        (for {
          annotation <- AnnotationDAO.findOneById(training) ?~> Messages("annotation.notFound")
          if (annotation.state.isReadyForReview)
          altered <- AnnotationDAO.assignReviewer(annotation, request.user) ?~> Messages("annotation.review.assignFailed")
        } yield {
          JsonOk(
            html.admin.training.trainingsTasksDetailTableItem(request.user, altered),
            Messages("annotation.review.assigned"))
        }) ?~> Messages("annotation.review.notReady")
      }
  }

  def oxalisReview(training: String) = Authenticated {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(training) ?~ Messages("annotation.notFound")
        review <- annotation.review.headOption ?~ Messages("annotation.review.notFound")
      } yield {
        Redirect(controllers.routes.AnnotationController.trace(AnnotationType.Review, review.reviewAnnotation.toString))
      }
  }

  def abortReview(trainingsId: String) = Authenticated {
    implicit request =>
      for {
        training <- AnnotationDAO.findOneById(trainingsId) ?~ Messages("annotation.review.notFound")
      } yield {
        val altered = training.update(_.unassignReviewer)
        JsonOk(
          html.admin.training.trainingsTasksDetailTableItem(request.user, altered),
          Messages("annotation.review.unassigned"))
      }
  }

  def finishReview(trainingId: String) = Authenticated {
    implicit request =>
      (for {
        annotation <- AnnotationDAO.findOneById(trainingId) ?~ Messages("annotation.notFound")
        review <- annotation.review.headOption ?~ Messages("annotation.review.notFound")
        if (review._reviewer == request.user._id && annotation.state.isInReview)
      } yield {
        Ok(html.admin.training.trainingsReview(annotation, reviewForm))
      }) ?~ Messages("tracing.review.finishFailed")
  }

  def finishReviewForm(training: String, passed: Boolean) = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      Async {
        reviewForm.bindFromRequest.fold(
        formWithErrors =>
          Future.successful(BadRequest), {
          comment =>
            (for {
              annotation <- AnnotationDAO.findOneById(training) ?~> Messages("annotation.notFound")
              if annotation.state.isInReview
              review <- annotation.review.headOption ?~> Messages("annotation.review.notFound")
              if review._reviewer == request.user._id
              task <- annotation.task ?~> Messages("annotation.task.notFound")
              training <- task.training ?~> Messages("annotation.training.notFound")
              trainee <- annotation.user ?~> Messages("annotation.user.notFound")
            } yield {
              if (passed) {
                UserService.increaseExperience(trainee._id, training.domain, training.gain)
                annotation.update(_.finishReview(comment).finish)
                Application.Mailer ! Send(
                  DefaultMails.trainingsSuccessMail(trainee.name, trainee.email, comment))
              } else {
                annotation.update(_.finishReview(comment).reopen)
                Application.Mailer ! Send(
                  DefaultMails.trainingsFailureMail(trainee.name, trainee.email, comment))
              }
              AnnotationDAO.findOneById(review.reviewAnnotation).map(reviewAnnotation =>
                reviewAnnotation.update(_.finish))
              JsonOk(Messages("annotation.review.finished"))
            }) ?~> Messages("annotation.review.finishFailed")
        })
      }
  }
}