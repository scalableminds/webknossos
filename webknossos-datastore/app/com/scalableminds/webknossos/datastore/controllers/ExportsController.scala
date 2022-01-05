package com.scalableminds.webknossos.datastore.controllers

import java.nio.file.Paths

import com.google.inject.Inject
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, UserAccessRequest}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class ExportsController @Inject()(
                                   accessTokenService: DataStoreAccessTokenService, config: DataStoreConfig)(implicit ec: ExecutionContext)
extends Controller
with FoxImplicits {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)

  def download(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(UserAccessRequest.listDataSources, token) {
      AllowRemoteOrigin {
        Ok(dataBaseDir.toString)
      }
    }
  }
}
