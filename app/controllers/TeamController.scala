package controllers


import javax.inject.Inject
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import models.team._
import models.user.UserTeamRolesDAO
import oxalis.security.WebknossosSilhouette
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.Action
import utils.ObjectId

class TeamController @Inject()(teamDAO: TeamDAO,
                               userTeamRolesDAO: UserTeamRolesDAO,
                               teamService: TeamService,
                               sil: WebknossosSilhouette,
                               val messagesApi: MessagesApi) extends Controller {

  implicit def userAwareRequestToDBAccess(implicit request: sil.UserAwareRequest[_]) = DBAccessContext(request.identity)
  implicit def securedRequestToDBAccess(implicit request: sil.SecuredRequest[_]) = DBAccessContext(Some(request.identity))

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

  def listAllTeams = Action.async { implicit request =>
    for {
      allTeams <- teamDAO.findAll(GlobalAccessContext)
      js <- Fox.serialCombined(allTeams)(t => teamService.publicWrites(t)(GlobalAccessContext))
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
