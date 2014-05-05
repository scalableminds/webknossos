package controllers

import oxalis.security.Secured
import models.team.{TeamService, Team, TeamDAO}
import play.api.libs.json.{JsError, JsSuccess, Writes, Json}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.User
import braingames.util.ExtendedTypes.ExtendedString
import scala.concurrent.Future
import play.api.i18n.Messages
import models.binary.{DataSetDAO, DataSet}
import net.liftweb.common.{Empty, Failure, Full}
import play.api.templates.Html
import braingames.reactivemongo.GlobalAccessContext
import braingames.util.DefaultConverters._

object TeamController extends Controller with Secured {

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def isTeamOwner(team: Team, user: User) =
    team.isEditableBy(user) match {
      case true  => Full(true)
      case false => Failure(Messages("notAllowed"))
    }

  def list = Authenticated.async{ implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: Team) =>
        el.isEditableBy(request.user) == value),
      Filter("isRoot", (value: Boolean, el: Team) =>
        el.parent.isEmpty == value),
      Filter("amIAnAdmin", (value: Boolean, el: Team) =>
        request.user.adminTeamNames.contains(el.name) == value)
    ){ filter =>
      for{
        allTeams <- TeamDAO.findAll
        filteredTeams = filter.applyOn(allTeams)
        js <- Future.traverse(filteredTeams)(Team.teamPublicWrites(_, request.user))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def delete(id: String) = Authenticated.async{ implicit request =>
    for{
      team <- TeamDAO.findOneById(id)
      _ <- isTeamOwner(team, request.user).toFox
      _ <- TeamService.remove(team)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def ensureRootTeam(team: Team) = {
    team.parent.isEmpty match {
      case true => Full(true)
      case _ => Empty
    }
  }

  def create = Authenticated.async(parse.json){ implicit request =>
    request.body.validate(Team.teamPublicReads(request.user)) match {
      case JsSuccess(team, _) =>
        TeamDAO.findOneByName(team.name)(GlobalAccessContext).futureBox.flatMap{
          case Empty =>
            for{
              parent <- team.parent.toFox.flatMap(TeamDAO.findOneByName(_)(GlobalAccessContext)) ?~> Messages("team.parent.notFound")
              _ <- ensureRootTeam(parent) ?~> Messages("team.parent.mustBeRoot") // current limitation
              _ <- TeamService.create(team, request.user)
              js <- Team.teamPublicWrites(team, request.user)
            } yield {
              Ok(js)
            }
          case _ =>
            Future.successful(JsonBadRequest(Messages("team.name.alreadyTaken")))
        }
      case e: JsError =>
        Future.successful(BadRequest(JsError.toFlatJson(e)))
    }
  }
}
