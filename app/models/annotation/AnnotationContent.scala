package models.annotation

import java.util.Date
import com.scalableminds.util.geometry.{BoundingBox, Scale, Point3D}
import java.io.InputStream
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.scalableminds.braingames.binary.models.{FallbackLayer, DataLayer}
import models.binary.{DataStoreInfo, DataSet, DataSetDAO}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.Logger
import net.liftweb.common.Box

trait AnnotationContent {
  type Self <: AnnotationContent

  def service: AnnotationContentService

  def id: String

  def editPosition: Point3D

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
      (__ \ 'elementClass).write[String])(l =>
      (l.name, l.category, l.maxCoordinates, l.resolutions, l.fallback, l.elementClass))

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
        "boundingBox" -> ac.boundingBox,
        "contentType" -> ac.contentType)
    }
  }
}
