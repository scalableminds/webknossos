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

  def getOrganizationData(organizationName: String) = Action.async{ implicit request =>
    for {
      org <- OrganizationDAO.findOneByName(organizationName)(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(org)(Organization.organizationFormat))
    }
  }

  def getOperatorData = Action.async { implicit request =>
    for {
      name <- Play.configuration.getString("operator.name").toFox
      additonalInformation = Play.configuration.getString("operator.additionalInformation")
      contact = Json.obj("email" -> Play.configuration.getString("operator.contact.email"),
        "phone" -> Play.configuration.getString("operator.contact.phone"),
        "web" -> Play.configuration.getString("operator.contact.web"))
      street <- Play.configuration.getString("operator.address.street").toFox
      town <- Play.configuration.getString("operator.address.town").toFox
      address = Json.obj("street" -> street, "town" -> town)
    } yield {
      Ok(Json.obj("name" -> name, "additionalInformation" -> additonalInformation, "contact" -> contact, "address" -> address))
    }
  }
}
