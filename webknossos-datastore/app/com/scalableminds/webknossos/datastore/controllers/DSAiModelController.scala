package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.{FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, PlayBodyParsers}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class GetEffectiveVoxelSizeParameters(
    modelPath: UPath
)

object GetEffectiveVoxelSizeParameters {
  implicit val jsonFormat: OFormat[GetEffectiveVoxelSizeParameters] = Json.format[GetEffectiveVoxelSizeParameters]
}

case class ModelStatistics(scale: Vec3Double)

object ModelStatistics {
  implicit val jsonFormat: OFormat[ModelStatistics] = Json.format[ModelStatistics]
}

class DSAiModelController @Inject()(accessTokenService: DataStoreAccessTokenService, dataVaultService: DataVaultService)(
    implicit ec: ExecutionContext,
    playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private lazy val filenameStatisticsJson = "statistics.json"

  def effectiveVoxelSize: Action[GetEffectiveVoxelSizeParameters] =
    Action.async(validateJson[GetEffectiveVoxelSizeParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          modelVaultPath <- dataVaultService.vaultPathFor(request.body.modelPath)
          statisticsFileBytes <- (modelVaultPath / "model" / filenameStatisticsJson)
            .readBytes() ?~> s"Could not model $filenameStatisticsJson info file."
          modelStatistics <- JsonHelper
            .parseAs[ModelStatistics](statisticsFileBytes)
            .toFox ?~> s"Could not parse model $filenameStatisticsJson – is the scale attribute missing?"
        } yield Ok(Json.toJson(VoxelSize.fromFactorWithDefaultUnit(modelStatistics.scale)))
      }
    }

}
