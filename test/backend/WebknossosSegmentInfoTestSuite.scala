package backend

import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.datastore.services.mesh.{
  MeshChunk,
  MeshLodInfo,
  SegmentMeshLookup,
  WebknossosSegmentInfo
}
import org.scalatest.wordspec.AsyncWordSpec

class WebknossosSegmentInfoTestSuite extends AsyncWordSpec {

  private val transform = Array(Array(1.0, 0.0, 0.0, 0.0), Array(0.0, 1.0, 0.0, 0.0), Array(0.0, 0.0, 1.0, 0.0))

  private def chunk(segmentId: Long, byteOffset: Long) =
    MeshChunk(Vec3Float(0, 0, 0), byteOffset, byteSize = 10, unmappedSegmentId = UnsignedLong(segmentId))

  "WebknossosSegmentInfo.fromSegmentLookups" should {
    "list the segments without an entry or without chunks as without mesh" in {
      val lookups = List(
        SegmentMeshLookup(1, Some(List(MeshLodInfo(List(chunk(1, 0)), transform)))),
        SegmentMeshLookup(2, None),
        SegmentMeshLookup(3, Some(List(MeshLodInfo(List.empty, transform))))
      )
      val info = WebknossosSegmentInfo.fromSegmentLookups(lookups, "draco")
      assert(info.map(_.lods.flatMap(_.chunks.map(_.byteOffset))).contains(List(0L)))
      assert(info.toOption.flatMap(_.segmentIdsWithoutMesh).map(_.map(_.toLong)).contains(List(2L, 3L)))
    }
  }
}
