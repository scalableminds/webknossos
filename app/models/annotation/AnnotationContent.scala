package models.annotation

import braingames.geometry.Scale
import braingames.geometry.Point3D
import play.api.libs.json.{JsValue, JsObject}
import java.util.Date
import java.io.InputStream

trait AnnotationContent {
  type Self <: AnnotationContent

  def id: String

  def scale: Scale

  def editPosition: Point3D

  def timestamp: Long

  def dataSetName: String

  def updateFromJson(jsUpdates: Seq[JsValue]): Option[Self]

  def settings: AnnotationSettings

  def isEditable = settings.isEditable

  def annotationInformation: JsObject

  def copyDeepAndInsert: Self

  def mergeWith(source: AnnotationContent): Self

  def clearTracingData(): Self

  def contentType: String

  def createTracingInformation(): JsObject

  def toDownloadStream: InputStream

  def downloadFileExtension: String

  lazy val date = new Date(timestamp)
}