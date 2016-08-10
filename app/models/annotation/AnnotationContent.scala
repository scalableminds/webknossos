package models.annotation

import java.util.Date

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerMapping, FallbackLayer}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.binary.{DataSet, DataSetDAO, DataStoreInfo}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._

trait AnnotationContent {
  type Self <: AnnotationContent

  def service: AnnotationContentService

  def id: String

  def editPosition: Point3D

  def editRotation: Vector3D

  def roundTripTime: Option[Double]

  def bandwidth: Option[Double]

  def totalBuckets: Option[Long]

  def boundingBox: Option[BoundingBox]

  def timestamp: Long

  def dataSetName: String

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[Self]

  def settings: AnnotationSettings

  def temporaryDuplicate(id: String)(implicit ctx: DBAccessContext): Fox[AnnotationContent]

  def saveToDB(implicit ctx: DBAccessContext): Fox[AnnotationContent]

  def mergeWith(source: AnnotationContent)(implicit ctx: DBAccessContext): Fox[AnnotationContent]

  def contentType: String

  def toDownloadStream(implicit ctx: DBAccessContext): Fox[Enumerator[Array[Byte]]]

  def downloadFileExtension: String

  def contentData: Fox[JsObject] = Fox.empty

  lazy val date = new Date(timestamp)

  def dataSet(implicit ctx: DBAccessContext): Fox[DataSet] = DataSetDAO.findOneBySourceName(dataSetName)
}

object AnnotationContent {

  import AnnotationSettings._

  implicit val dataLayerWrites: Writes[DataLayer] =
    ((__ \ 'name).write[String] and
      (__ \ 'category).write[String] and
      (__ \ 'maxCoordinates).write[BoundingBox] and
      (__ \ 'resolutions).write[List[Int]] and
      (__ \ 'fallback).write[Option[FallbackLayer]] and
      (__ \ 'elementClass).write[String] and
      (__ \ 'mappings).write[List[DataLayerMapping]])(l =>
      (l.name, l.category, l.maxCoordinates, l.resolutions, l.fallback, l.elementClass, l.mappings))

  implicit val dataSetWrites: Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'dataStore).write[DataStoreInfo] and
      (__ \ 'scale).write[Option[Scale]] and
      (__ \ 'dataLayers).write[Option[List[DataLayer]]])(d =>
      (d.name, d.dataStoreInfo, d.dataSource.map(_.scale), d.dataSource.map(_.dataLayers)))

  def writeAsJson(ac: AnnotationContent)(implicit ctx: DBAccessContext) = {
    for {
      dataSet <- ac.dataSet.futureBox
      contentData <- ac.contentData getOrElse Json.obj()
    } yield {
      Json.obj(
        "settings" -> ac.settings,
        "dataSet" -> dataSet.toOption,
        "contentData" -> contentData,
        "editPosition" -> ac.editPosition,
        "editRotation" -> ac.editRotation,
        "roundTripTime" -> ac.roundTripTime,
        "bandwidth" -> ac.bandwidth,
        "totalBuckets" -> ac.totalBuckets,
        "boundingBox" -> ac.boundingBox,
        "contentType" -> ac.contentType)
    }
  }
}
