package utils

import com.scalableminds.util.mvc.ApiVersioning
import controllers.ReleaseInformationDAO
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class BuildInfoService @Inject()(releaseInformationDAO: ReleaseInformationDAO, storeModules: StoreModules)
    extends ApiVersioning {

  def buildInfoJson(implicit ec: ExecutionContext): Future[JsObject] =
    for {
      schemaVersion <- releaseInformationDAO.getSchemaVersion.futureBox
    } yield
      Json.obj(
        "webknossos" -> Json.toJson(
          webknossos.BuildInfo.toMap.view.mapValues(_.toString).filterKeys(_ != "certificatePublicKey").toMap),
        "schemaVersion" -> schemaVersion.toOption,
        "httpApiVersioning" -> apiVersioningInfo,
        "localDataStoreEnabled" -> storeModules.localDataStoreEnabled,
        "localTracingStoreEnabled" -> storeModules.localTracingStoreEnabled
      )
}
