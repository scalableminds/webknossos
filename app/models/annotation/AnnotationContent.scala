package models.annotation

import braingames.geometry.Scale
import braingames.geometry.Point3D
import play.api.libs.json.JsObject

trait AnnotationContent {
  def scale: Scale
  def editPosition: Point3D
  
  def timestamp: Long
  
  def dataSetName: String

  def settings: AnnotationSettings

  def isEditable = settings.isEditable

  def annotationInformation: JsObject
}