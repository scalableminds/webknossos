package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.{ElementClass => ProtoElementClass}
import com.scalableminds.webknossos.datastore.geometry.{
  BoundingBox => ProtoBoundingBox,
  Point3D => ProtoPoint3D,
  Vector3D => ProtoVector3D
}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}

trait ProtoGeometryImplicits {

  implicit def point3DToProto(p: Point3D): ProtoPoint3D = ProtoPoint3D(p.x, p.y, p.z)

  implicit def point3DFromProto(p: ProtoPoint3D): Point3D = Point3D(p.x, p.y, p.z)

  implicit def vector3DToProto(v: Vector3D): ProtoVector3D = ProtoVector3D(v.x, v.y, v.z)

  implicit def vector3DFromProto(v: ProtoVector3D): Vector3D = Vector3D(v.x, v.y, v.z)

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
