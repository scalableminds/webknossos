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

  def vec3IntToProto(p: Vec3Int): Vec3IntProto = Vec3IntProto(p.x, p.y, p.z)

  def vec3IntOptToProto(pOpt: Option[Vec3Int]): Option[Vec3IntProto] =
    pOpt.map(vec3IntToProto)

  def vec3IntFromProto(p: Vec3IntProto): Vec3Int = Vec3Int(p.x, p.y, p.z)

  def vec3DoubleToProto(v: Vec3Double): Vec3DoubleProto = Vec3DoubleProto(v.x, v.y, v.z)

  def vec3DoubleFromProto(v: Vec3DoubleProto): Vec3Double = Vec3Double(v.x, v.y, v.z)

  def boundingBoxToProto(bb: BoundingBox): BoundingBoxProto =
    BoundingBoxProto(vec3IntToProto(bb.topLeft), bb.width, bb.height, bb.depth)

  def boundingBoxFromProto(bb: BoundingBoxProto): BoundingBox =
    BoundingBox(vec3IntFromProto(bb.topLeft), bb.width, bb.height, bb.depth)

  def boundingBoxOptToProto(bbOpt: Option[BoundingBox]): Option[BoundingBoxProto] =
    bbOpt.map(boundingBoxToProto)

  def boundingBoxOptFromProto(bbOpt: Option[BoundingBoxProto]): Option[BoundingBox] =
    bbOpt.map(bb => BoundingBox(vec3IntFromProto(bb.topLeft), bb.width, bb.height, bb.depth))

  def elementClassFromProto(ec: ElementClassProto): ElementClass.Value =
    ElementClass.fromProto(ec)

  def colorToProto(c: com.scalableminds.util.image.Color): ColorProto =
    ColorProto(c.r, c.g, c.b, c.a)

  def colorFromProto(c: ColorProto): com.scalableminds.util.image.Color =
    com.scalableminds.util.image.Color(c.r, c.g, c.b, c.a)

  def colorOptToProto(cOpt: Option[com.scalableminds.util.image.Color]): Option[ColorProto] =
    cOpt.map(colorToProto)

  def arrayFromVec2IntProto(p: Vec2IntProto): Array[Int] = Array(p.x, p.y)

}
