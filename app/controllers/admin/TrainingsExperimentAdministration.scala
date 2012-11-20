package controllers.admin

import brainflight.security.Secured
import models.security.Role
import controllers.Controller
import models.tracing.Tracing
import views._
import models.user.User
import play.api.data._
import play.api.data.Forms._

object TrainingsTracingAdministration extends Controller with Secured {
  val DefaultRole = Role.Admin

  val reviewForm = Form(
    single(
      "comment" -> text))

  def startReview(training: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(training)
      altered <- Tracing.assignReviewee(tracing, request.user)
    } yield {
      AjaxOk.success(
        html.admin.task.trainingsTasksDetailTableItem(request.user, altered),
        "You got assigned as reviewee.")
    }) getOrElse BadRequest("Trainings-Tracing not found.")
  }

  def oxalisReview(training: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(training)
      review <- tracing.review
    } yield {
      Redirect(controllers.routes.Game.trace(review.reviewTracing.toString))
    }) getOrElse BadRequest("Couldn't create review tracing.")
  }

  def abortReview(trainingsId: String) = Authenticated { implicit request =>
    Tracing.findOneById(trainingsId) map { training =>
      val altered = training.update(_.unassign)
      AjaxOk.success(
        html.admin.task.trainingsTasksDetailTableItem(request.user, altered),
        "You got unassigned from this training.")
    } getOrElse BadRequest("Trainings-Tracing not found.")
  }

  def finishReview(training: String) = Authenticated { implicit request =>
    Tracing.findOneById(training) map { tracing =>
      tracing.review match {
        case Some(r) if r._reviewee == request.user._id =>
          Ok(html.admin.task.trainingsReview(tracing, reviewForm))
        case _ =>
          BadRequest("No open review found.")
      }
    } getOrElse BadRequest("Trainings-Tracing not found.")
  }

  def finishReviewForm(training: String, passed: Boolean) = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    reviewForm.bindFromRequest.fold(
      formWithErrors =>
        BadRequest,
      { comment =>
        (for {
          tracing <- Tracing.findOneById(training)
          if tracing.state.isInReview
          review <- tracing.review
          if review._reviewee == request.user._id
          task <- tracing.task
          training <- task.training
          trainee <- tracing.user
        } yield {
          if (passed) {
            User.addExperience(trainee, training.domain, training.gain)
            tracing.update(_.finishReview(comment).finish)
          } else
            tracing.update(_.finishReview(comment).reopen)
          AjaxOk.success("Trainings review finished.")
        }) getOrElse AjaxBadRequest.error("Trainings-Tracing not found.")
      })
  }
}