/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import play.api.mvc.Action
import models.binary._
import com.scalableminds.util.reactivemongo.DBAccessContext
import oxalis.security.Secured
import com.scalableminds.util.tools.Fox
import com.scalableminds.braingames.binary.models.DataLayer
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

object DataTokenController extends Controller with Secured{
  def validate(token: String, dataSetName: String, dataLayerName: String) = Action.async{ implicit request =>
    DataTokenService.validate(token, dataSetName, dataLayerName).map{
      case true =>
        Ok
      case false =>
        Forbidden
    }
  }

  def ensureAccessToLayer(dataSet: DataSet, dataLayerName: String)(implicit ctx: DBAccessContext): Fox[DataLayer] = {
    dataSet.dataSource.flatMap(_.getDataLayer(dataLayerName))
      .toFox
      .orElse(UserDataLayerDAO.findOneByName(dataLayerName).map(_.dataLayer))
  }

  def generate(dataSetName: String, dataLayerName: String) = UserAwareAction.async{ implicit request =>
    for{
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      _ <- ensureAccessToLayer(dataSet, dataLayerName) ?~> Messages("dataLayer.forbidden") ~> FORBIDDEN
      token <- DataTokenService.generate(request.userOpt, dataSetName, dataLayerName) ?~> Messages("dataToken.creationFailed")
    } yield {
      Ok(Json.toJson(token))
    }
  }
}
