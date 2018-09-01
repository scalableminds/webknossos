package controllers


import javax.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.team._
import models.user.UserTeamRolesDAO
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.Action
import utils.ObjectId

class TeamController @Inject()(val messagesApi: MessagesApi) extends Controller {

  private def teamNameReads: Reads[String] =
    (__ \ "name").read[String]

  def list = SecuredAction.async { implicit request =>
    for {
      allTeams <- TeamDAO.findAllEditable
      js <- Fox.serialCombined(allTeams)(_.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listAllTeams = Action.async { implicit request =>
    for {
      allTeams <- TeamDAO.findAll(GlobalAccessContext)
      js <- Fox.serialCombined(allTeams)(_.publicWrites(GlobalAccessContext))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def delete(id: String) = SecuredAction.async { implicit request =>
    for {
      teamIdValidated <- ObjectId.parse(id)
      team <- TeamDAO.findOne(teamIdValidated) ?~> "team.notFound"
      _ <- TeamDAO.deleteOne(teamIdValidated)
      _ <- UserTeamRolesDAO.removeTeamFromAllUsers(teamIdValidated)
    } yield {
      JsonOk(Messages("team.deleted"))
    }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(teamNameReads) { teamName =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin"
        team = Team(ObjectId.generate, request.identity._organization, teamName)
        _ <- TeamDAO.insertOne(team)
        js <- team.publicWrites
      } yield {
        JsonOk(js, Messages("team.created"))
      }
    }
  }
}
