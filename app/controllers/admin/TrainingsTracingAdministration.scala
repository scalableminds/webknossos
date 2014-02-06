package controllers.admin

import oxalis.security.Secured
import models.user.{UserService, User}
import play.api.data._
import play.api.data.Forms._
import play.api.i18n.Messages
import controllers.{Controller, Application}
import braingames.mail.Send
import oxalis.mail.DefaultMails
import models.annotation._
import models.tracing.skeleton.SkeletonTracing
import views._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.util.ExtendedTypes.ExtendedBoolean
import braingames.mail.Send

object TrainingsTracingAdministration extends AdminController {

  val reviewForm = Form(
    single(
      "comment" -> text))

  def startReview(training: String) = Authenticated.async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(training) ?~> Messages("annotation.notFound")
      _ <- annotation.state.isReadyForReview.failIfFalse(Messages("annotation.review.notReady")).toFox
      updated <- annotation.muta.assignReviewer(request.user) ?~> Messages("annotation.review.assignFailed")
      content <- updated.content.futureBox
    } yield {
      JsonOk(
        html.admin.annotation.simpleAnnotation(updated, Some(request.user), content),
        Messages("annotation.review.assigned"))
    }
  }

  def oxalisReview(training: String) = Authenticated.async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(training) ?~> Messages("annotation.notFound")
      review <- annotation.review.headOption ?~> Messages("annotation.review.notFound")
    } yield {
      Redirect(controllers.routes.AnnotationController.trace(AnnotationType.Review, review.reviewAnnotation.stringify))
    }
  }

  def abortReview(trainingsId: String) = Authenticated.async { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(trainingsId) ?~> Messages("annotation.review.notFound")
      updated <- annotation.muta.unassignReviewer() ?~> Messages("annotation.update.failed")
      content <- updated.content.futureBox
    } yield {
      JsonOk(
        html.admin.annotation.simpleAnnotation(updated, Some(request.user), content),
        Messages("annotation.review.unassigned"))
    }
  }

  def finishReview(trainingId: String) = Authenticated.async { implicit request =>
    def isAllowedToFinish(review: AnnotationReview, annotation: AnnotationLike) =
      review._reviewer == request.user._id && annotation.state.isInReview

    for {
      annotation <- AnnotationDAO.findOneById(trainingId) ?~> Messages("annotation.notFound")
      review <- annotation.review.headOption ?~ Messages("annotation.review.notFound")
      _ <- isAllowedToFinish(review, annotation) failIfFalse Messages("tracing.review.finishFailed")
    } yield {
      Ok(html.admin.training.trainingsReview(annotation, reviewForm))
    }
  }

  def finishReviewForm(training: String, passed: Boolean) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    def isUserReviewer(review: AnnotationReview) =
      review._reviewer == request.user._id

    reviewForm.bindFromRequest.fold(
    formWithErrors => Future.successful(BadRequest), {
      comment =>
        (for {
          annotation <- AnnotationDAO.findOneById(training) ?~> Messages("annotation.notFound")
          if (annotation.state.isInReview)
          review <- annotation.review.headOption ?~> Messages("annotation.review.notFound")
          if (isUserReviewer(review))
          _ <- annotation.muta.finishReview(review, passed, comment)
        } yield {
          JsonOk(Messages("annotation.review.finished"))
        }) ~> Messages("annotation.review.finishFailed")
    })
  }
}