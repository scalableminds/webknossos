package models.annotation.nml

import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup}

case class NmlVolumeTag(dataZipPath: String,
                        fallbackLayerName: Option[String],
                        name: Option[String],
                        segments: Seq[Segment],
                        largestSegmentId: Option[Long],
                        segmentGroups: Seq[SegmentGroup]) {}
