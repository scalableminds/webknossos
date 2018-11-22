package controllers

import javax.inject.Inject
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import models.team._
import models.user.UserTeamRolesDAO
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json._
import play.api.mvc.Action
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TeamController @Inject()(teamDAO: TeamDAO,
                               userTeamRolesDAO: UserTeamRolesDAO,
                               teamService: TeamService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  private def teamNameReads: Reads[String] =
    (__ \ "name").read[String]

  def list = sil.SecuredAction.async { implicit request =>
    for {
      allTeams <- teamDAO.findAllEditable
      js <- Fox.serialCombined(allTeams)(t => teamService.publicWrites(t))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def delete(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      teamIdValidated <- ObjectId.parse(id)
      team <- teamDAO.findOne(teamIdValidated) ?~> "team.notFound"
      _ <- teamDAO.deleteOne(teamIdValidated)
      _ <- userTeamRolesDAO.removeTeamFromAllUsers(teamIdValidated)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def create = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(teamNameReads) { teamName =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin"
        team = Team(ObjectId.generate, request.identity._organization, teamName)
        _ <- teamDAO.insertOne(team)
        js <- teamService.publicWrites(team)
      } yield {
        JsonOk(js, Messages("team.created"))
      }
    }
  }
}
