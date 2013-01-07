package controllers.admin

import brainflight.security.Secured
import models.security.Role
import braingames.mvc.Controller
import models.tracing.Tracing
import views._
import models.user.User
import play.api.data._
import play.api.data.Forms._
import play.api.i18n.Messages
import controllers.Application
import brainflight.mail.Send
import brainflight.mail.DefaultMails

object TrainingsTracingAdministration extends Controller with Secured {
  // finished localization
  val DefaultRole = Role.Admin

  val reviewForm = Form(
    single(
      "comment" -> text))

  def startReview(training: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(training) ?~ Messages("tracing.notFound")
      if (tracing.state.isReadyForReview)
      altered <- Tracing.assignReviewee(tracing, request.user) ?~ Messages("tracing.review.assignFailed")
    } yield {
      JsonOk(
        html.admin.task.trainingsTasksDetailTableItem(request.user, altered),
        Messages("tracing.review.assigned"))
    }) ?~ Messages("tracing.review.notReady")
  }

  def oxalisReview(training: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(training) ?~ Messages("tracing.notFound")
      review <- tracing.review.headOption ?~ Messages("tracing.review.notFound")
    } yield {
      Redirect(controllers.routes.Game.trace(review.reviewTracing.toString))
    }
  }

  def abortReview(trainingsId: String) = Authenticated { implicit request =>
    for {
      training <- Tracing.findOneById(trainingsId) ?~ Messages("tracing.review.notFound")
    } yield {
      val altered = training.update(_.unassignReviewer)
      JsonOk(
        html.admin.task.trainingsTasksDetailTableItem(request.user, altered),
        Messages("tracing.review.unassigned"))
    }
  }

  def finishReview(trainingId: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(trainingId) ?~ Messages("tracing.notFound")
      review <- tracing.review.headOption ?~ Messages("tracing.review.notFound")
      if (review._reviewee == request.user._id && tracing.state.isInReview)
    } yield {
      Ok(html.admin.task.trainingsReview(tracing, reviewForm))
    }) ?~ Messages("tracing.review.finishFailed")
  }

  def finishReviewForm(training: String, passed: Boolean) = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    reviewForm.bindFromRequest.fold(
      formWithErrors =>
        BadRequest,
      { comment =>
        (for {
          tracing <- Tracing.findOneById(training) ?~ Messages("tracing.notFound")
          if tracing.state.isInReview
          review <- tracing.review.headOption ?~ Messages("tracing.review.notFound")
          if review._reviewee == request.user._id
          task <- tracing.task ?~ Messages("tracing.task.notFound")
          training <- task.training ?~ Messages("tracing.training.notFound")
          trainee <- tracing.user ?~ Messages("tracing.user.notFound")
        } yield {
          if (passed) {
            trainee.update(_.addExperience(training.domain, training.gain))
            tracing.update(_.finishReview(comment).finish)
            Application.Mailer ! Send(
              DefaultMails.trainingsSuccessMail(trainee.name, trainee.email, comment))
          } else {
            tracing.update(_.finishReview(comment).reopen)
            Application.Mailer ! Send(
              DefaultMails.trainingsFailureMail(trainee.name, trainee.email, comment))
          }
          Tracing.findOneById(review.reviewTracing).map(reviewTracing =>
            reviewTracing.update(_.finish))
          JsonOk(Messages("tracing.review.finished"))
        }) ?~ Messages("tracing.review.finishFailed")
      })
  }
}