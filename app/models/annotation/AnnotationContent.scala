package models.annotation

import java.util.Date
import braingames.geometry.{BoundingBox, Scale, Point3D}
import java.io.InputStream
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.binary.models.{DataLayer, DataSet}
import models.binary.DataSetDAO
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext

trait AnnotationContent {
  type Self <: AnnotationContent

  def id: String

  def editPosition: Point3D

  def timestamp: Long

  def dataSetName: String

  def updateFromJson(jsUpdates: Seq[JsValue]): Option[Self]

  def settings: AnnotationSettings

  def copyDeepAndInsert: Self

  def mergeWith(source: AnnotationContent): Self

  def clearTracingData(): Self

  def contentType: String

  def toDownloadStream: Future[InputStream]

  def downloadFileExtension: String

  def contentData: Option[JsObject] = None

  lazy val date = new Date(timestamp)

  def dataSet(implicit ctx: DBAccessContext): Future[Option[DataSet]] = DataSetDAO.findOneByName(dataSetName)
}

object AnnotationContent {

  import AnnotationSettings._

  implicit val dataLayerWrites: Writes[DataLayer] =
    ((__ \ 'typ).write[String] and
      (__ \ 'maxCoordinates).write[BoundingBox] and
      (__ \ 'resolutions).write[List[Int]])(l =>
      (l.typ, l.maxCoordinates, l.resolutions))

  implicit val dataSetWrites: Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'scale).write[Scale] and
      (__ \ 'dataLayers).write[List[DataLayer]])(d =>
      (d.name, d.scale, d.dataLayers))

  def writeAnnotationContent(ac: AnnotationContent)(implicit ctx: DBAccessContext) = {
    ac.dataSet.map {
      dataSet =>
        ((__ \ 'settings).write[AnnotationSettings] and
          (__ \ 'dataSet).write[Option[DataSet]] and
          (__ \ 'contentData).write[Option[JsObject]] and
          (__ \ 'editPosition).write[Point3D] and
          (__ \ 'contentType).write[String])
          .tupled
          .writes((ac.settings, dataSet, ac.contentData, ac.editPosition, ac.contentType))
    }
  }
}