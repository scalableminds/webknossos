package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, UserAccessRequest}
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import java.nio.file.Files
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class GetEffectiveVoxelSizeParameters(
    modelPath: UPath
)

object GetEffectiveVoxelSizeParameters {
  implicit val jsonFormat: OFormat[GetEffectiveVoxelSizeParameters] = Json.format[GetEffectiveVoxelSizeParameters]
}

class DSAiModelController @Inject()(accessTokenService: DataStoreAccessTokenService)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers) extends Controller with FoxImplicits {

  def effectiveVoxelSize: Action[GetEffectiveVoxelSizeParameters] = Action.async(validateJson[GetEffectiveVoxelSizeParameters]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
      for {
        // TODO
        fullPath = exportProperties.fullPathIn(config.Datastore.baseDirectory)
        _ <- Fox.fromBool(Files.exists(fullPath)) ?~> "job.export.fileNotFound"
      } yield Ok.sendPath(fullPath, inline = false)
    }
  }
}
