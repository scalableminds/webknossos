package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.{ElementClass => ElementClassProto}
import com.scalableminds.webknossos.datastore.geometry.{BoundingBoxProto, ColorProto, Vec3DoubleProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

trait ProtoGeometryImplicits {

  implicit def vec3IntToProto(p: Vec3Int): Vec3IntProto = Vec3IntProto(p.x, p.y, p.z)

  implicit def vec3IntFromProto(p: Vec3IntProto): Vec3Int = Vec3Int(p.x, p.y, p.z)

  implicit def vec3DoubleToProto(v: Vec3Double): Vec3DoubleProto = Vec3DoubleProto(v.x, v.y, v.z)

  implicit def vec3DoubleFromProto(v: Vec3DoubleProto): Vec3Double = Vec3Double(v.x, v.y, v.z)

  implicit def boundingBoxToProto(bb: BoundingBox): BoundingBoxProto =
    BoundingBoxProto(bb.topLeft, bb.width, bb.height, bb.depth)

  implicit def boundingBoxFromProto(bb: BoundingBoxProto): BoundingBox =
    BoundingBox(bb.topLeft, bb.width, bb.height, bb.depth)

  implicit def boundingBoxOptToProto(bbOpt: Option[BoundingBox]): Option[BoundingBoxProto] =
    bbOpt.map(boundingBoxToProto)

  implicit def boundingBoxOptFromProto(bbOpt: Option[BoundingBoxProto]): Option[BoundingBox] =
    bbOpt.map(bb => BoundingBox(bb.topLeft, bb.width, bb.height, bb.depth))

  implicit def elementClassToProto(ec: ElementClass.Value): ElementClassProto =
    ElementClassProto.fromValue(ElementClass.bytesPerElement(ec))

  implicit def elementClassFromProto(ec: ElementClassProto): ElementClass.Value =
    ElementClass.guessFromBytesPerElement(ec.value).getOrElse(ElementClass.uint32)

  implicit def colorToProto(c: com.scalableminds.util.image.Color): ColorProto =
    ColorProto(c.r, c.g, c.b, c.a)

  implicit def colorOptToProto(cOpt: Option[com.scalableminds.util.image.Color]): Option[ColorProto] =
    cOpt.map(colorToProto)

}
