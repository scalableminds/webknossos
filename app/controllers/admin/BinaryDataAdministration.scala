package controllers.admin

import oxalis.security.Secured
import views._
import play.api.libs.concurrent.Execution.Implicits._
import models.binary.DataSetDAO
import controllers.Controller

object BinaryDataAdministration extends AdminController {

  def list = Authenticated.async { implicit request =>
    DataSetDAO.findAllOwnedBy(request.user.adminTeamNames).map { dataSets =>
      Ok(html.admin.binary.binaryData(dataSets))
    }
  }
}