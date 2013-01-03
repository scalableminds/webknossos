package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.templates.Html
import brainflight.security.Secured
import models.security.Role
import models.binary.DataSet
import play.api.Logger
import models.tracing.Tracing
import models.user._
import models.tracing.UsedTracings
import views._
import brainflight.security.AuthenticatedRequest
import models.tracing.TracingType
import play.api.i18n.Messages

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createTracingIDInfo(tracingId: String) = Json.obj(
    "task" -> Json.obj(
      "id" -> tracingId))

  def htmlForTracing(tracing: Tracing)(implicit request: AuthenticatedRequest[_]) = {
    val additionalHtml =
      (if (tracing.tracingType == TracingType.Review) {
        Tracing.findTrainingForReviewTracing(tracing).map { training =>
          html.admin.task.trainingsReviewItem(training, admin.TrainingsTracingAdministration.reviewForm)
        }
      } else
        tracing.review.headOption.flatMap(_.comment).map(comment =>
          html.oxalis.trainingsComment(comment))).getOrElse(Html.empty)
    html.oxalis.trace(tracing)(additionalHtml)
  }

  def index = Authenticated { implicit request =>
    UsedTracings
      .by(request.user)
      .headOption
      .flatMap(Tracing.findOneById)
      .map(tracing => Ok(htmlForTracing(tracing)))
      .getOrElse(Redirect(routes.UserController.dashboard))
  }

  def trace(tracingId: String) = Authenticated { implicit request =>
    val user = request.user
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (tracing._user == user._id)
    } yield {
      UsedTracings.use(user, tracing)
      Ok(htmlForTracing(tracing))
    }) ?~ Messages("notAllowed") ~> 403
  }

  def initialize = Authenticated { implicit request =>
    val user = request.user
    for {
      tracing <- UsedTracings.by(user).headOption ?~ Messages("tracing.open.notFound")
    } yield {
      Ok(createTracingIDInfo(tracing.toString))
    }
  }
}