package controllers.admin

import oxalis.security.Secured
import views._
import play.api.libs.concurrent.Execution.Implicits._
import models.binary.DataSetDAO
import controllers.Controller
import play.api.templates.Html

object BinaryDataAdministration extends AdminController {

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

}