package controllers.admin

import braingames.mvc.Controller
import play.api.libs.concurrent.Akka
import play.api.Play.current
import oxalis.security.Secured
import akka.actor.Props
import braingames.binary.models.DataSet
import akka.util.Timeout
import scala.concurrent.duration._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import play.api.libs.concurrent._
import views._
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import models.security.Role
import models.binary.DataSetDAO

object BinaryDataAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin
  
  def list = Authenticated { implicit request =>
    Async{
      DataSetDAO.findAll.map{ dataSets=>
        Ok(html.admin.binary.binaryData(dataSets))
      }
    }
  }
}