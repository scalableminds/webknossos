/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.scalableminds.braingames.datastore.SkeletonTracing._
import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracingLayer.ElementClass
import com.scalableminds.braingames.datastore.VolumeTracing._
import com.scalableminds.braingames.datastore.geometry._
import com.trueaccord.scalapb.{GeneratedEnum, GeneratedEnumCompanion}
import play.api.data.validation.ValidationError
import play.api.libs.json._

import scala.collection.Seq

trait ProtoJsonFormats {

  def enumNameReads[E <: GeneratedEnum](companion: GeneratedEnumCompanion[E]): Reads[E] = new Reads[E] {
    def reads(json: JsValue) = json match {
      case JsString(str) => {
        companion.fromName(str)
          .map(e => e.asInstanceOf[E])
          .map(JsSuccess(_))
          .getOrElse(JsError(Seq(JsPath() -> Seq(ValidationError("error.expected.validenumvalue")))))
      }
      case _ => JsError(Seq(JsPath() -> Seq(ValidationError("error.expected.enumstring"))))
    }
  }

  def enumNameWrites[E <: GeneratedEnum]: Writes[E] = new Writes[E] {
    def writes(value: E): JsValue = JsString(value.toString)
  }


  implicit val colorFormat = Json.format[Color]
  implicit val point3DFormat = Json.format[Point3D]
  implicit val vector3DFormat = Json.format[Vector3D]
  implicit val boundingBoxFormat = Json.format[BoundingBox]
  implicit val nodeFormat = Json.format[Node]
  implicit val edgeFormat = Json.format[Edge]
  implicit val branchPointFormat = Json.format[BranchPoint]
  implicit val commentFormat = Json.format[Comment]
  implicit val treeFormat = Json.format[Tree]
  implicit val skeletonTracingFormat = Json.format[SkeletonTracing]
  implicit val dataLayerElementClassFormat = Format(enumNameReads(ElementClass), enumNameWrites[ElementClass])
  implicit val volumeTracingLayerFormat = Json.format[VolumeTracingLayer]
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

}
