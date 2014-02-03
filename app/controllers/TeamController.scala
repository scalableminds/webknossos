package controllers

import oxalis.security.Secured
import models.team.{Team, TeamDAO}
import play.api.libs.json.{Writes, Json}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.User
import braingames.util.ExtendedTypes.ExtendedString

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
}
