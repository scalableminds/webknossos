package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import models.team._
import play.api.Play
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.Action
import play.api.Play.current

class OrganizationController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def listAllOrganizations = Action.async { implicit request =>
    for {
      allOrgs <- OrganizationDAO.findAll(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(allOrgs.map(org => Json.obj("id" -> org.id, "name" -> org.name, "additionalInformation" -> org.additionalInformation))))
    }
  }

  def getOperatorData = Action.async { implicit request =>
    for {
      data <- Play.configuration.getString("operatorData").toFox
    } yield {
      Ok(Json.toJson(data))
    }
  }
}
