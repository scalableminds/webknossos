package com.scalableminds.webknossos.datastore.controllers

import java.nio.file.{Files, Path}
import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{AutoFormat, Fox}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.services.{
  BaseDirService,
  DSRemoteWebknossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

case class JobExportProperties(jobId: String, runId: String, organizationId: String, exportFileName: String)
    derives AutoFormat {

  def fullPathIn(orgaDir: Path): Path =
    orgaDir.resolve(".export").resolve(runId).resolve(exportFileName)
}

class ExportsController @Inject() (
    webknossosClient: DSRemoteWebknossosClient,
    accessTokenService: DataStoreAccessTokenService,
    baseDirService: BaseDirService
)(implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def download(jobId: ObjectId): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.downloadJobExport(jobId)) {
      for {
        exportProperties <- webknossosClient.getJobExportProperties(jobId)
        orgaDir <- baseDirService.getOneLocalForOrga(exportProperties.organizationId).toFox
        fullPath = exportProperties.fullPathIn(orgaDir)
        _ <- Fox.fromBool(Files.exists(fullPath)) ?~> Msg.Job.exportFileNotFound
      } yield Ok.sendPath(fullPath, inline = false)
    }

  }

}
