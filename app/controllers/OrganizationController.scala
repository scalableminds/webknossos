package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.DefaultConverters._
import models.team._
import models.user.UserService
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.Play
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.Action
import play.api.Play.current

import scala.concurrent.Future

class OrganizationController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def listAllOrganizations = Action.async { implicit request =>
    for {
      allOrgs <- OrganizationDAO.findAll(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(allOrgs.map(_.name)))
    }
  }

  def getOrganizationData = Action.async{ implicit request =>
    for {
      org <- OrganizationDAO.findAll(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(org.map(_.additionalInformation)))
    }
  }

  def getOperatorData = Action.async { implicit request =>
    for {
      data <- Play.configuration.getString("operator").toFox
    } yield {
      Ok(Json.toJson(data))
    }
  }
}
