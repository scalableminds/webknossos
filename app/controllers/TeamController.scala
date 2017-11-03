package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.DefaultConverters._
import models.team._
import models.user.UserService
import net.liftweb.common.{Empty, Full}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.twirl.api.Html

import scala.concurrent.Future

class TeamController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  def empty = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def list = Authenticated.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: Team) =>
        el.isEditableBy(request.user) == value),
      Filter("isRoot", (value: Boolean, el: Team) =>
        el.parent.isEmpty == value),
      Filter("amIAnAdmin", (value: Boolean, el: Team) =>
        request.user.isAdminOf(el.name) == value)
    ) { filter =>
      for {
        allTeams <- TeamDAO.findAll
        filteredTeams = filter.applyOn(allTeams)
        js <- Future.traverse(filteredTeams)(Team.teamPublicWrites(_, request.user))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def delete(id: String) = Authenticated.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)
      _ <- team.owner.contains(request.user._id) ?~> Messages("team.noOwner")
      _ <- TeamService.remove(team)
      _ <- UserService.removeTeamFromUsers(team)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def ensureRootTeam(team: Team) = {
    team.parent.isEmpty match {
      case true => Full(true)
      case _    => Empty
    }
  }

  def create = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(Team.teamPublicReads(request.user)) { team =>
      for {
        _ <- TeamDAO.findOneByName(team.name)(GlobalAccessContext).reverse ?~> Messages("team.name.alreadyTaken")
        parent <- team.parent.toFox.flatMap(TeamDAO.findOneByName(_)(GlobalAccessContext)) ?~> Messages("team.parent.notFound")
        _ <- ensureRootTeam(parent) ?~> Messages("team.parent.mustBeRoot") // current limitation
        _ <- TeamService.create(team, request.user)
        js <- Team.teamPublicWrites(team, request.user)
      } yield {
        JsonOk(js, Messages("team.created"))
      }
    }
  }
}
