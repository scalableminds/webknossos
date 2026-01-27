package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.DataStoreAccessTokenService
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class DataProxyController @Inject()(accessTokenService: DataStoreAccessTokenService, config: DataStoreConfig)(
    implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def proxyMag(datasetId: String, dataLayerName: String, mag: String, path: String): Action[AnyContent] = Action.async {
    implicit request =>
      val requestedRange: Option[String] = request.headers.get(RANGE)
      Fox.successful(Ok(path))
  }

  def proxyAttachment(datasetId: String,
                      dataLayerName: String,
                      attachmentName: String,
                      path: String): Action[AnyContent] = Action.async { implicit request =>
    val requestedRange: Option[String] = request.headers.get(RANGE)
    Fox.successful(Ok(path))
  }

}
