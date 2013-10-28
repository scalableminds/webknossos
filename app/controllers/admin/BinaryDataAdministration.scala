package controllers.admin

import oxalis.security.Secured
import views._
import play.api.libs.concurrent.Execution.Implicits._
import models.security.Role
import models.binary.DataSetDAO
import controllers.Controller

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