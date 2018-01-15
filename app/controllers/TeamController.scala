package controllers


import javax.inject.Inject

import oxalis.security.WebknossosSilhouette.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.DefaultConverters._
import models.team._
import models.user.UserService
import net.liftweb.common.{Empty, Full}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.twirl.api.Html
import play.api.mvc.{Action, _}

import scala.concurrent.Future

class TeamController @Inject()(val messagesApi: MessagesApi) extends Controller {


  def list = SecuredAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: Team) =>
        el.isEditableBy(request.identity) == value),
      Filter("amIAnAdmin", (value: Boolean, el: Team) =>
        request.identity.isSuperVisorOf(el._id) == value)
    ) { filter =>
      for {
        allTeams <- TeamDAO.findAll
        filteredTeams = filter.applyOn(allTeams)
        js <- Future.traverse(filteredTeams)(Team.teamPublicWrites(_, request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def listAllTeams = Action.async { implicit request =>
    for {
      allTeams <- TeamDAO.findAll(GlobalAccessContext)
      js <- Future.traverse(allTeams)(Team.teamPublicWritesBasic(_)(GlobalAccessContext))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def delete(id: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)
      _ <- team.isAdminOfOrganization(request.identity) ?~> Messages("team.noOwner") //team.owner.contains(request.identity._id)
      _ <- TeamService.remove(team)
      _ <- UserService.removeTeamFromUsers(team)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Team.teamPublicReads(request.identity)) { team =>
      for {
        _ <- TeamDAO.findOneByName(team.name)(GlobalAccessContext).reverse ?~> Messages("team.name.alreadyTaken")
        parent <- team.parent.toFox.flatMap(TeamDAO.findOneByName(_)(GlobalAccessContext)) ?~> Messages("team.parent.notFound") //TODO
        _ <- ensureRootTeam(parent) ?~> Messages("team.parent.mustBeRoot") // current limitation
        _ <- TeamService.create(team, request.identity)
        js <- Team.teamPublicWrites(team, request.identity)
      } yield {
        JsonOk(js, Messages("team.created"))
      }
    }
  }
}
