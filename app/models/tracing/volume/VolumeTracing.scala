package models.tracing.volume

import braingames.geometry.{Point3D, BoundingBox}
import models.annotation.{AnnotationContentService, AnnotationContent, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary.UserDataLayerDAO
import models.binary.DataSet
import java.io.InputStream
import play.api.libs.json.{Json, JsValue}
import braingames.reactivemongo.{DBAccessContext, GlobalAccessContext}
import braingames.util.{FoxImplicits, Fox}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import controllers.DataStoreHandler

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
  dataSetName: String,
  userDataLayerName: String,
  timestamp: Long = System.currentTimeMillis(),
  editPosition: Point3D = Point3D(0,0,0),
  boundingBox: Option[BoundingBox] = None,
  settings: AnnotationSettings = AnnotationSettings.volumeDefault,
  _id: BSONObjectID = BSONObjectID.generate)
  extends AnnotationContent {

  def id = _id.stringify

  type Self = VolumeTracing

  def service = VolumeTracingService

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext) = {Fox.successful(this)}

  def copyDeepAndInsert = ???

  def mergeWith(source: AnnotationContent) = ???

  def contentType: String = VolumeTracing.contentType

  def toDownloadStream: Fox[InputStream] = ???

  def downloadFileExtension: String = ???

  override def contentData = {
    UserDataLayerDAO.findOneByName(userDataLayerName)(GlobalAccessContext).map{ userDataLayer =>
      Json.obj(
        "customLayers" -> List(userDataLayer.dataLayer)
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
    for {
      baseSource <- baseDataSet.dataSource.toFox
      dataLayer <- DataStoreHandler.createUserDataSource(baseSource)
      volumeTracing = VolumeTracing(baseDataSet.name, dataLayer.dataLayer.name)
      _ <- UserDataLayerDAO.insert(dataLayer)
      _ <- VolumeTracingDAO.insert(volumeTracing)
    } yield {
      volumeTracing
    }
  }

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???
}

object VolumeTracing{
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

  val contentType = "volumeTracing"
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat
}
