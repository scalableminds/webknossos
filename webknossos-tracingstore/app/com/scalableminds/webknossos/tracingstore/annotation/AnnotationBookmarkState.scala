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
import com.scalableminds.webknossos.datastore.geometry.Vec2DoubleProto
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryConversions, UnsignedLong}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkMappingType.BookmarkMappingType
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkViewMode.BookmarkViewMode

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

case class BookmarkMapping(mappingName: String, mappingType: BookmarkMappingType) derives JsonAutoFormat {
  def toProto: BookmarkMappingProto = BookmarkMappingProto(mappingName, BookmarkMappingType.toProto(mappingType))
}

case class BookmarkMesh(
    segmentId: UnsignedLong,
    seedPosition: Vec3Int,
    isPrecomputed: Boolean,
    meshFileName: Option[String],
    mappingName: Option[String],
    mappingType: Option[BookmarkMappingType]
) extends ProtoGeometryConversions derives JsonAutoFormat {
  def toProto: BookmarkMeshProto =
    BookmarkMeshProto(
      segmentId = segmentId.toLong,
      seedPosition = vec3IntToProto(seedPosition),
      isPrecomputed = isPrecomputed,
      meshFileName = meshFileName,
      mappingName = mappingName,
      mappingType = mappingType.map(BookmarkMappingType.toProto)
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
    mode: BookmarkViewMode,
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
      mode = BookmarkViewMode.toProto(mode),
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
