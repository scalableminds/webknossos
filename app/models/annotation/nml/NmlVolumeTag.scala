package models.annotation.nml

import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat

case class NmlVolumeTag(dataZipPath: String,
                        fallbackLayerName: Option[String],
                        name: Option[String],
                        segments: Seq[Segment],
                        largestSegmentId: Option[Long],
                        format: VolumeDataZipFormat,
                        segmentGroups: Seq[SegmentGroup]) {}
