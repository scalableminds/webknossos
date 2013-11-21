package controllers

import oxalis.security.Secured
import models.security.{RoleDAO, Role}
import models.binary.DataSetDAO
import play.api.i18n.Messages
import views.html
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 03.08.13
 * Time: 17:58
 */
object DataSetController extends Controller with Secured {
  override val DefaultAccessRole = RoleDAO.User


  def view(dataSetName: String) = UserAwareAction.async {
    implicit request =>
      for {
        dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
      } yield {
        Ok(html.tracing.view(dataSet))
      }
  }

  def list = UserAwareAction.async {
    implicit request =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(html.dataSets(dataSets))
      }
  }
}

