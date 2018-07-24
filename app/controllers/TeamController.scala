package controllers


import javax.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.team._
import models.user.UserTeamRolesSQLDAO
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.Action
import utils.ObjectId

class TeamController @Inject()(val messagesApi: MessagesApi) extends Controller {


  def list = SecuredAction.async { implicit request =>
    for {
      allTeams <- TeamSQLDAO.findAllEditable
      js <- Fox.serialCombined(allTeams)(_.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listAllTeams = Action.async { implicit request =>
    for {
      allTeams <- TeamSQLDAO.findAll(GlobalAccessContext)
      js <- Fox.serialCombined(allTeams)(_.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def delete(id: String) = SecuredAction.async { implicit request =>
    for {
      teamIdValidated <- ObjectId.parse(id)
      team <- TeamSQLDAO.findOne(teamIdValidated)
      _ <- TeamSQLDAO.deleteOne(teamIdValidated)
      _ <- UserTeamRolesSQLDAO.removeTeamFromAllUsers(teamIdValidated)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Team.teamReadsName) { teamName =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> Messages("user.noAdmin")
        team = TeamSQL(ObjectId.generate, request.identity._organization, teamName)
        _ <- TeamSQLDAO.insertOne(team)
        js <- team.publicWrites
      } yield {
        JsonOk(js, Messages("team.created"))
      }
    }
  }
}
