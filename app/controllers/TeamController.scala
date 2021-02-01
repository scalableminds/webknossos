package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import models.team._
import models.user.UserTeamRolesDAO
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json._
import utils.ObjectId
import javax.inject.Inject
import models.binary.DataSetAllowedTeamsDAO
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class TeamController @Inject()(teamDAO: TeamDAO,
                               userTeamRolesDAO: UserTeamRolesDAO,
                               datasetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                               teamService: TeamService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
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

  def delete(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      teamIdValidated <- ObjectId.parse(id)
      _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin" ~> FORBIDDEN
      team <- teamDAO.findOne(teamIdValidated) ?~> "team.notFound" ~> NOT_FOUND
      _ <- bool2Fox(!team.isOrganizationTeam) ?~> "team.delete.organizationTeam" ~> FORBIDDEN
      _ <- teamDAO.deleteOne(teamIdValidated)
      _ <- teamService.assertNoReferences(teamIdValidated) ?~> "team.delete.inUse" ~> FORBIDDEN
      _ <- userTeamRolesDAO.removeTeamFromAllUsers(teamIdValidated)
      _ <- datasetAllowedTeamsDAO.removeTeamFromAllDatasets(teamIdValidated)
    } yield JsonOk(Messages("team.deleted"))
  }

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(teamNameReads) { teamName =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin" ~> FORBIDDEN
        team = Team(ObjectId.generate, request.identity._organization, teamName)
        _ <- teamDAO.insertOne(team)
        js <- teamService.publicWrites(team)
      } yield JsonOk(js, Messages("team.created"))
    }
  }
}
