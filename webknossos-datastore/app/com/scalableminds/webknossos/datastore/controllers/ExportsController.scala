package com.scalableminds.webknossos.datastore.controllers

import java.nio.file.{Files, Path}
import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

case class JobExportProperties(jobId: String, runId: String, organizationId: String, exportFileName: String) {

  def fullPathIn(baseDir: Path): Path =
    baseDir.resolve(organizationId).resolve(".export").resolve(runId).resolve(exportFileName)
}

object JobExportProperties {
  implicit val jsonFormat: OFormat[JobExportProperties] = Json.format[JobExportProperties]
}

class ExportsController @Inject()(webknossosClient: DSRemoteWebknossosClient,
                                  accessTokenService: DataStoreAccessTokenService,
                                  config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val dataBaseDir: Path = Path.of(config.Datastore.baseDirectory)

  override def allowRemoteOrigin: Boolean = true

  def download(jobId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.downloadJobExport(jobId)) {
      for {
        exportProperties <- webknossosClient.getJobExportProperties(jobId)
        fullPath = exportProperties.fullPathIn(dataBaseDir)
        _ <- Fox.fromBool(Files.exists(fullPath)) ?~> "job.export.fileNotFound"
      } yield Ok.sendPath(fullPath, inline = false)
    }

  }

}
