package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import models.dataset.{DatasetDAO, UnifiedDatasetService}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import play.silhouette.api.Silhouette
import security.{URLSharing, WkEnv}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Unified datasets prototype. All actions are only available if features.unifiedDatasets is enabled.
class UnifiedDatasetController @Inject() (
    datasetDAO: DatasetDAO,
    unifiedDatasetService: UnifiedDatasetService,
    conf: WkConf,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext)
    extends Controller {

  private def assertFeatureEnabled: Fox[Unit] =
    Fox.fromBool(conf.Features.unifiedDatasets) ?~> "unifiedDatasets.disabled" ~> NOT_FOUND

  // Returns the annotation that holds the dataset's annotation layers, creating an empty one if the requesting user
  // may edit annotation layers and none exists yet.
  def backingAnnotation(datasetId: ObjectId, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        _ <- assertFeatureEnabled
        dataset <- datasetDAO.findOne(datasetId)(using ctx) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        info <- unifiedDatasetService.findOrCreateBackingAnnotation(dataset, request.identity)
      } yield Ok(Json.toJson(info))
    }
}
