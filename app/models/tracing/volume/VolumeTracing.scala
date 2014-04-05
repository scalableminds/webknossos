package models.tracing.volume

import braingames.geometry.{Point3D, BoundingBox}
import models.annotation.{AnnotationLike, AnnotationContentService, AnnotationContent, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary.UserDataLayerDAO
import models.binary.DataSet
import java.io.InputStream
import play.api.libs.json.{Json, JsValue}
import oxalis.binary.BinaryDataService
import scala.concurrent.Future
import braingames.reactivemongo.{DBAccessContext, GlobalAccessContext}
import braingames.util.{FoxImplicits, Fox}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import braingames.binary.models.DataLayer

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
  dataSetName: String,
  userDataLayerName: String,
  timestamp: Long,
  activeCellId: Option[Int],
  editPosition: Point3D,
  zoomLevel: Double,
  boundingBox: Option[BoundingBox],
  settings: AnnotationSettings = AnnotationSettings.volumeDefault,
  _id: BSONObjectID = BSONObjectID.generate)
  extends AnnotationContent {

  def id = _id.stringify

  type Self = VolumeTracing

  def service = VolumeTracingService

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[VolumeTracing] = {
    val updates = jsUpdates.flatMap { json =>
      TracingUpdater.createUpdateFromJson(json)
    }
    if (jsUpdates.size == updates.size) {
      for {
        updatedTracing <- updates.foldLeft(Fox.successful(this)) {
          case (f, updater) => f.flatMap(tracing => updater.update(tracing))
        }
        _ <- VolumeTracingDAO.update(updatedTracing._id, updatedTracing.copy(timestamp = System.currentTimeMillis))(GlobalAccessContext)
      } yield updatedTracing
    } else {
      Fox.empty
    }
  }

  def copyDeepAndInsert = ???

  def mergeWith(source: AnnotationContent) = ???

  def contentType: String = VolumeTracing.contentType

  def toDownloadStream: Fox[InputStream] = ???

  def downloadFileExtension: String = ???

  override def contentData = {
    UserDataLayerDAO.findOneByName(userDataLayerName)(GlobalAccessContext).map{ userDataLayer =>
      Json.obj(
        "activeCell" -> activeCellId,
        "customLayers" -> List(AnnotationContent.dataLayerWrites.writes(userDataLayer.dataLayer)),
        "zoomLevel" -> zoomLevel
      )
    }
  }
}

object VolumeTracingService extends AnnotationContentService with FoxImplicits{
  type AType = VolumeTracing

  def dao = VolumeTracingDAO

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    VolumeTracingDAO.findOneById(id)

  def createFrom(baseDataSet: DataSet)(implicit ctx: DBAccessContext) = {
    baseDataSet.dataSource.toFox.flatMap{ baseSource =>
      val dataLayer = BinaryDataService.createUserDataSource(baseSource)
      val t = VolumeTracing(baseDataSet.name, dataLayer.dataLayer.name, System.currentTimeMillis(), None, baseDataSet.defaultStart, VolumeTracing.defaultZoomLevel, None)
      for{
      _ <- UserDataLayerDAO.insert(dataLayer)
      _ <- VolumeTracingDAO.insert(t)
      } yield t
    }
  }

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???
}

object VolumeTracing{
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

  val contentType = "volumeTracing"

  val defaultZoomLevel = 0.0
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat
}
