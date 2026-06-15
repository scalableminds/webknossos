package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import models.team._
import models.user.UserDAO
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TeamController @Inject()(teamDAO: TeamDAO, userDAO: UserDAO, teamService: TeamService, sil: Silhouette[WkEnv])(
    implicit ec: ExecutionContext)
    extends Controller {

  private def teamNameReads: Reads[String] =
    (__ \ "name").read[String]

  def list(isEditable: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    val onlyEditableTeams = isEditable.getOrElse(false)
    for {
      allTeams <- if (onlyEditableTeams) teamDAO.findAllEditable else teamDAO.findAll
      js <- Fox.serialCombined(allTeams)(t => teamService.publicWrites(t))
    } yield Ok(Json.toJson(js))
  }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.fromBool(request.identity.isAdmin) ?~> Msg.Team.deleteOnlyAdmin ~> FORBIDDEN
      team <- teamDAO.findOne(id) ?~> Msg.Team.notFound(id) ~> NOT_FOUND
      _ <- Fox.fromBool(!team.isOrganizationTeam) ?~> Msg.Team.deleteOrganizationTeam ~> FORBIDDEN
      _ <- teamService.assertNoReferences(id) ?~> Msg.Team.deleteInUse ~> FORBIDDEN
      _ <- teamDAO.deleteOne(id)
      _ <- userDAO.removeTeamFromAllUsers(id)
      _ <- teamDAO.removeTeamFromAllDatasetsAndFolders(id)
    } yield JsonOk(Msg.Team.deleteSuccess)
  }

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(teamNameReads) { teamName =>
      for {
        _ <- Fox.fromBool(request.identity.isAdmin) ?~> Msg.Team.createOnlyAdmin ~> FORBIDDEN
        existingTeamCount <- teamDAO.countByNameAndOrganization(teamName, request.identity._organization)
        _ <- Fox.fromBool(existingTeamCount == 0) ?~> Msg.Team.nameTaken(teamName)
        team = Team(ObjectId.generate, request.identity._organization, teamName)
        _ <- teamDAO.insertOne(team)
        js <- teamService.publicWrites(team)
      } yield JsonOk(js, Msg.Team.createSuccess)
    }
  }
}
