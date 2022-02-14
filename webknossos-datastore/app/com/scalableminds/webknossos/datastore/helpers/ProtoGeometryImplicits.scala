package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int, Vec3Double}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.{ElementClass => ProtoElementClass}
import com.scalableminds.webknossos.datastore.geometry.{
  BoundingBox => ProtoBoundingBox,
  Point3D => ProtoPoint3D,
  Vector3D => ProtoVector3D
}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

trait ProtoGeometryImplicits {

  implicit def vec3IntToProto(p: Vec3Int): ProtoPoint3D = ProtoPoint3D(p.x, p.y, p.z)

  implicit def vec3IntFromProto(p: ProtoPoint3D): Vec3Int = Vec3Int(p.x, p.y, p.z)

  implicit def vec3DoubleToProto(v: Vec3Double): ProtoVector3D = ProtoVector3D(v.x, v.y, v.z)

  implicit def vec3DoubleFromProto(v: ProtoVector3D): Vec3Double = Vec3Double(v.x, v.y, v.z)

  implicit def boundingBoxToProto(bb: BoundingBox): ProtoBoundingBox =
    ProtoBoundingBox(bb.topLeft, bb.width, bb.height, bb.depth)

  implicit def boundingBoxFromProto(bb: ProtoBoundingBox): BoundingBox =
    BoundingBox(bb.topLeft, bb.width, bb.height, bb.depth)

  implicit def boundingBoxOptToProto(bbOpt: Option[BoundingBox]): Option[ProtoBoundingBox] =
    bbOpt.map(boundingBoxToProto)

  implicit def boundingBoxOptFromProto(bbOpt: Option[ProtoBoundingBox]): Option[BoundingBox] =
    bbOpt.map(bb => BoundingBox(bb.topLeft, bb.width, bb.height, bb.depth))

  implicit def elementClassToProto(ec: ElementClass.Value): ProtoElementClass =
    ProtoElementClass.fromValue(ElementClass.bytesPerElement(ec))

  implicit def elementClassFromProto(ec: ProtoElementClass): ElementClass.Value =
    ElementClass.guessFromBytesPerElement(ec.value).getOrElse(ElementClass.uint32)

}
