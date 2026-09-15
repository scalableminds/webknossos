package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.geometry.{
  BoundingBoxProto,
  ColorProto,
  Vec2IntProto,
  Vec3DoubleProto,
  Vec3IntProto
}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

trait ProtoGeometryConversions {

  protected def vec3IntToProto(p: Vec3Int): Vec3IntProto = Vec3IntProto(p.x, p.y, p.z)

  protected def vec3IntOptToProto(pOpt: Option[Vec3Int]): Option[Vec3IntProto] =
    pOpt.map(vec3IntToProto)

  protected def vec3IntFromProto(p: Vec3IntProto): Vec3Int = Vec3Int(p.x, p.y, p.z)

  protected def vec3DoubleToProto(v: Vec3Double): Vec3DoubleProto = Vec3DoubleProto(v.x, v.y, v.z)

  protected def vec3DoubleFromProto(v: Vec3DoubleProto): Vec3Double = Vec3Double(v.x, v.y, v.z)

  protected def boundingBoxToProto(bb: BoundingBox): BoundingBoxProto =
    BoundingBoxProto(vec3IntToProto(bb.topLeft), bb.width, bb.height, bb.depth)

  protected def boundingBoxFromProto(bb: BoundingBoxProto): BoundingBox =
    BoundingBox(vec3IntFromProto(bb.topLeft), bb.width, bb.height, bb.depth)

  protected def boundingBoxOptToProto(bbOpt: Option[BoundingBox]): Option[BoundingBoxProto] =
    bbOpt.map(boundingBoxToProto)

  protected def boundingBoxOptFromProto(bbOpt: Option[BoundingBoxProto]): Option[BoundingBox] =
    bbOpt.map(bb => BoundingBox(vec3IntFromProto(bb.topLeft), bb.width, bb.height, bb.depth))

  protected def elementClassFromProto(ec: ElementClassProto): ElementClass.Value =
    ElementClass.fromProto(ec)

  protected def colorToProto(c: com.scalableminds.util.image.Color): ColorProto =
    ColorProto(c.r, c.g, c.b, c.a)

  protected def colorFromProto(c: ColorProto): com.scalableminds.util.image.Color =
    com.scalableminds.util.image.Color(c.r, c.g, c.b, c.a)

  protected def colorOptToProto(cOpt: Option[com.scalableminds.util.image.Color]): Option[ColorProto] =
    cOpt.map(colorToProto)

  protected def arrayFromVec2IntProto(p: Vec2IntProto): Array[Int] = Array(p.x, p.y)

}
