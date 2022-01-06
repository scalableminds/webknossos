package com.scalableminds.webknossos.datastore.controllers

import java.nio.file.{Files, Path, Paths}

import com.google.inject.Inject
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebKnossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

case class JobExportProperties(jobId: String, runId: String, organizationName: String, exportFileName: String) {

  def fullPathIn(baseDir: Path): Path =
    baseDir.resolve(organizationName).resolve(".export").resolve(runId).resolve(exportFileName)
}

object JobExportProperties {
  implicit val jsonFormat: OFormat[JobExportProperties] = Json.format[JobExportProperties]
}

class ExportsController @Inject()(webKnossosClient: DSRemoteWebKnossosClient,
                                  accessTokenService: DataStoreAccessTokenService,
                                  config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val dataBaseDir: Path = Paths.get(config.Datastore.baseFolder)

  def download(token: Option[String], jobId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.downloadJobExport(jobId), token) {
      AllowRemoteOrigin {
        for {
          exportProperties <- webKnossosClient.getJobExportProperties(jobId)
          fullPath = exportProperties.fullPathIn(dataBaseDir)
          _ <- bool2Fox(Files.exists(fullPath)) ?~> "job.export.fileNotFound"
        } yield Ok.sendPath(fullPath, inline = false)
      }
    }

  }

}
