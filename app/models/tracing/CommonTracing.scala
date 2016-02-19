/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.tracing

import com.scalableminds.util.geometry.BoundingBox
import models.annotation.AnnotationSettings

trait CommonTracing {
  def dataSetName: String

  def boundingBox: Option[BoundingBox]

  def settings: AnnotationSettings

  def editPosition: Point3D
}
