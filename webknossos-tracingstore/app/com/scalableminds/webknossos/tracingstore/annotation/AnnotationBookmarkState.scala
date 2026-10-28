package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{
  AnnotationBookmarkStateProto,
  BookmarkLayerStateProto,
  BookmarkMappingProto,
  BookmarkMeshProto,
  BookmarkTdCameraProto
}
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.{
  MappingTypeProto,
  ViewModeProto
}
import com.scalableminds.webknossos.datastore.geometry.Vec2DoubleProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryConversions, UnsignedLong}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import play.api.libs.json.{Format, JsError, JsString, JsSuccess, Reads, Writes}
import scalapb.{GeneratedEnum, GeneratedEnumCompanion}

private def protoEnumFormat[E <: GeneratedEnum](companion: GeneratedEnumCompanion[E]): Format[E] =
  Format(
    Reads {
      case JsString(name) =>
        companion
          .fromName(name)
          .map(JsSuccess(_))
          .getOrElse(JsError(s"Invalid ${companion.scalaDescriptor.name}: $name"))
      case _ => JsError(s"Expected string for ${companion.scalaDescriptor.name}")
    },
    Writes(value => JsString(value.name))
  )

given Format[ViewModeProto] = protoEnumFormat(ViewModeProto)
given Format[MappingTypeProto] = protoEnumFormat(MappingTypeProto)

case class BookmarkTdCamera(
    position: Vec3Double,
    up: Vec3Double,
    left: Double,
    right: Double,
    top: Double,
    bottom: Double
) extends ProtoGeometryConversions derives JsonAutoFormat {
  def toProto: BookmarkTdCameraProto =
    BookmarkTdCameraProto(vec3DoubleToProto(position), vec3DoubleToProto(up), left, right, top, bottom)
}

case class BookmarkMapping(mappingName: String, mappingType: MappingTypeProto) derives JsonAutoFormat {
  def toProto: BookmarkMappingProto = BookmarkMappingProto(mappingName, mappingType)
}

case class BookmarkMesh(
    segmentId: UnsignedLong,
    seedPosition: Vec3Int,
    isPrecomputed: Boolean,
    meshFileName: Option[String],
    mappingName: Option[String],
    mappingType: Option[MappingTypeProto]
) extends ProtoGeometryConversions derives JsonAutoFormat {
  def toProto: BookmarkMeshProto =
    BookmarkMeshProto(
      segmentId = segmentId.toLong,
      seedPosition = vec3IntToProto(seedPosition),
      isPrecomputed = isPrecomputed,
      meshFileName = meshFileName,
      mappingName = mappingName,
      mappingType = mappingType
    )
}

case class BookmarkLayerState(
    layerName: String,
    isDisabled: Option[Boolean],
    intensityRange: Option[Seq[Double]], // [min, max]
    color: Option[Vec3Double],
    isInverted: Option[Boolean],
    gammaCorrectionValue: Option[Double],
    mapping: Option[BookmarkMapping],
    meshFileName: Option[String],
    meshes: Seq[BookmarkMesh] = Seq.empty
) extends ProtoGeometryConversions derives JsonAutoFormat {
  def toProto: BookmarkLayerStateProto =
    BookmarkLayerStateProto(
      layerName = layerName,
      isDisabled = isDisabled,
      intensityRange = intensityRange.collect { case Seq(min, max) => Vec2DoubleProto(min, max) },
      color = color.map(vec3DoubleToProto),
      isInverted = isInverted,
      gammaCorrectionValue = gammaCorrectionValue,
      mapping = mapping.map(_.toProto),
      meshFileName = meshFileName,
      meshes = meshes.map(_.toProto)
    )
}

case class AnnotationBookmarkState(
    position: Vec3Int,
    mode: ViewModeProto,
    zoomStep: Double,
    rotation: Vec3Double,
    activeNodeId: Option[Int],
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    nativelyRenderedLayerName: Option[String],
    clippingDistance: Double,
    clipSkeletonToCurrentSection: Boolean,
    tdCamera: Option[BookmarkTdCamera],
    showSkeletons: Option[Boolean],
    layers: Seq[BookmarkLayerState] = Seq.empty
) extends ProtoGeometryConversions derives JsonAutoFormat {
  def toProto: AnnotationBookmarkStateProto =
    AnnotationBookmarkStateProto(
      position = vec3IntToProto(position),
      mode = mode,
      zoomStep = zoomStep,
      rotation = vec3DoubleToProto(rotation),
      activeNodeId = activeNodeId,
      additionalCoordinates = AdditionalCoordinate.toProto(additionalCoordinates),
      nativelyRenderedLayerName = nativelyRenderedLayerName,
      clippingDistance = clippingDistance,
      clipSkeletonToCurrentSection = clipSkeletonToCurrentSection,
      tdCamera = tdCamera.map(_.toProto),
      showSkeletons = showSkeletons,
      layers = layers.map(_.toProto)
    )
}
