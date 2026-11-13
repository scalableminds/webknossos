package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto.ThumbnailViewportProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.{
  MappingTypeProto,
  ViewModeProto
}

// JSON counterparts of the bookmark proto enums, used in the update actions. The value names are part of the JSON
// format of stored update actions, so they must not change.

object BookmarkViewMode extends ExtendedEnumeration {
  type BookmarkViewMode = Value
  val orthogonal, flight = Value

  def toProto(viewMode: BookmarkViewMode): ViewModeProto = viewMode match {
    case `orthogonal` => ViewModeProto.orthogonal
    case `flight`     => ViewModeProto.flight
  }
}

object BookmarkMappingType extends ExtendedEnumeration {
  type BookmarkMappingType = Value
  val JSON, AGGLOMERATE = Value

  def toProto(mappingType: BookmarkMappingType): MappingTypeProto = mappingType match {
    case JSON        => MappingTypeProto.JSON
    case AGGLOMERATE => MappingTypeProto.AGGLOMERATE
  }
}

object BookmarkThumbnailViewport extends ExtendedEnumeration {
  type BookmarkThumbnailViewport = Value
  val XY, YZ, XZ, TD, FLIGHT = Value

  def toProto(viewport: BookmarkThumbnailViewport): ThumbnailViewportProto = viewport match {
    case XY     => ThumbnailViewportProto.XY
    case YZ     => ThumbnailViewportProto.YZ
    case XZ     => ThumbnailViewportProto.XZ
    case TD     => ThumbnailViewportProto.TD
    case FLIGHT => ThumbnailViewportProto.FLIGHT
  }
}
