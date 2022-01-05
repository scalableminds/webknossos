package com.scalableminds.webknossos.datastore.controllers

import java.nio.file.{Files, Paths}

import com.google.inject.Inject
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, JobExportId, UserAccessRequest}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class ExportsController @Inject()(accessTokenService: DataStoreAccessTokenService, config: DataStoreConfig)(
    implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)

  def download(token: Option[String], jobId: String, filePath: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.downloadJobExport(jobId, filePath), token) {
        AllowRemoteOrigin {
          val fullPath = dataBaseDir.resolve(filePath)
          for {
            _ <- bool2Fox(Files.exists(fullPath)) ?~> "job.export.fileNotFound"
          } yield Ok.sendPath(fullPath, inline = false)
        }
      }
  }

}
