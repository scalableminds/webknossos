package controllers


import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.DefaultConverters._
import models.team._
import models.user.UserService
import net.liftweb.common.{Empty, Full}
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.Future

class TeamController @Inject()(val messagesApi: MessagesApi) extends Controller {


  def list = SecuredAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: Team) =>
        el.isEditableBy(request.identity) == value)
    ) { filter =>
      for {
        allTeams <- TeamDAO.findAll
        filteredTeams = filter.applyOn(allTeams)
        js <- Future.traverse(filteredTeams)(Team.teamPublicWrites(_))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def listAllTeams = Action.async { implicit request =>
    for {
      allTeams <- TeamDAO.findAll(GlobalAccessContext)
      js <- Future.traverse(allTeams)(Team.teamPublicWrites(_)(GlobalAccessContext))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def delete(id: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)
      _ <- TeamService.remove(team)
      _ <- UserService.removeTeamFromUsers(team)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Team.teamReadsName) { teamName =>
      val team = Team(teamName, request.identity.organization)
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> Messages("user.noAdmin")
        _ <- TeamService.create(team, request.identity)
        js <- Team.teamPublicWrites(team)
      } yield {
        JsonOk(js, Messages("team.created"))
      }
    }
  }
}
