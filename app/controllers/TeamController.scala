package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import io.swagger.annotations._
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

@Api
class TeamController @Inject()(teamDAO: TeamDAO,
                               userTeamRolesDAO: UserTeamRolesDAO,
                               datasetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                               teamService: TeamService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  private def teamNameReads: Reads[String] =
    (__ \ "name").read[String]

  @ApiOperation(value = "List all accessible teams.", nickname = "teamList")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON list containing one object per resulting team."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def list(@ApiParam(value = "When true, show only teams the current user can edit.") isEditable: Option[Boolean])
    : Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    val onlyEditableTeams = isEditable.getOrElse(false)
    for {
      allTeams <- if (onlyEditableTeams) teamDAO.findAllEditable else teamDAO.findAll
      js <- Fox.serialCombined(allTeams)(t => teamService.publicWrites(t))
    } yield Ok(Json.toJson(js))
  }

  @ApiOperation(hidden = true, value = "")
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

  @ApiOperation(hidden = true, value = "")
  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(teamNameReads) { teamName =>
      for {
        existingTeamCount <- teamDAO.countByNameAndOrganization(teamName, request.identity._organization)
        _ <- bool2Fox(existingTeamCount == 0) ?~> "team.nameInUse"
        _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin" ~> FORBIDDEN
        team = Team(ObjectId.generate, request.identity._organization, teamName)
        _ <- teamDAO.insertOne(team)
        js <- teamService.publicWrites(team)
      } yield JsonOk(js, Messages("team.created"))
    }
  }
}
