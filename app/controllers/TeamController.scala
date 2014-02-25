package controllers

import oxalis.security.Secured
import models.team.{TeamService, Team, TeamDAO}
import play.api.libs.json.{JsError, JsSuccess, Writes, Json}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.User
import braingames.util.ExtendedTypes.ExtendedString
import scala.concurrent.Future
import play.api.i18n.Messages

object TeamController extends Controller with Secured {

  def list = Authenticated.async{ implicit request =>
    for{
      teams <- TeamDAO.findAll
    } yield{
      val filtered = request.getQueryString("isEditable").flatMap(_.toBooleanOpt) match{
        case Some(isEditable) =>
          teams.filter(_.isEditableBy(request.user) == isEditable)
        case None =>
          teams
      }
      Ok(Writes.list(Team.teamPublicWrites(request.user)).writes(filtered))
    }
  }

  def create = Authenticated.async(parse.json){ implicit request =>
    request.body.validate(Team.teamPublicReads(request.user)) match {
      case JsSuccess(team, _) =>
        TeamService.create(team, request.user).map{ _ =>
          JsonOk(Messages("team.created"))
        }
      case e: JsError =>
        Future.successful(BadRequest(JsError.toFlatJson(e)))
    }
  }
}
