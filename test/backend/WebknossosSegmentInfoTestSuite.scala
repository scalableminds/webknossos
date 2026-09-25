package backend

import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.datastore.services.mesh.{MeshChunk, MeshLodInfo, WebknossosSegmentInfo}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.Json

class WebknossosSegmentInfoTestSuite extends AsyncWordSpec {

  private val transform = Array(Array(1.0, 0.0, 0.0, 0.0), Array(0.0, 1.0, 0.0, 0.0), Array(0.0, 0.0, 1.0, 0.0))

  private def chunk(segmentId: Long, byteOffset: Long) =
    MeshChunk(Vec3Float(0, 0, 0), byteOffset, byteSize = 10, unmappedSegmentId = UnsignedLong(segmentId))

  private def segmentInfo(chunksPerLod: List[List[MeshChunk]]) =
    WebknossosSegmentInfo(meshFormat = "draco", lods = chunksPerLod.map(chunks => MeshLodInfo(chunks, transform)))

  "WebknossosSegmentInfo.withSegmentIdsWithoutMesh" should {
    "list the requested segments that have no chunk in any lod" in {
      val info = segmentInfo(List(List(chunk(1, 0)), List(chunk(1, 10), chunk(2, 20))))
      val withoutMesh = info.withSegmentIdsWithoutMesh(Seq(1L, 2L, 3L, 3L, 4L)).segmentIdsWithoutMesh
      assert(withoutMesh.map(_.map(_.toLong)).contains(List(3L, 4L)))
    }

    "list all requested segments if there are no lods" in {
      val withoutMesh = segmentInfo(List.empty).withSegmentIdsWithoutMesh(Seq(5L, 6L)).segmentIdsWithoutMesh
      assert(withoutMesh.map(_.map(_.toLong)).contains(List(5L, 6L)))
    }

    "write the segments without a mesh as unsigned longs and omit them if unset" in {
      val info = segmentInfo(List(List(chunk(1, 0))))
      assert((Json.toJson(info) \ "segmentIdsWithoutMesh").isEmpty)
      assert(
        (Json.toJson(info.withSegmentIdsWithoutMesh(Seq(1L, 7L))) \ "segmentIdsWithoutMesh").get ==
          Json.arr(Json.obj("customJsonEncoding" -> "bigint", "value" -> "7"))
      )
    }
  }

  "WebknossosSegmentInfo.fromMeshInfosAndMetadataAllowingNoChunks" should {
    "return an info without lods if no segment has chunks" in {
      val info = WebknossosSegmentInfo.fromMeshInfosAndMetadataAllowingNoChunks(List.empty, "draco")
      assert(info.map(_.lods).contains(List.empty))
    }

    "merge the lods of all segments like fromMeshInfosAndMetadata" in {
      val chunkInfos =
        List(List(MeshLodInfo(List(chunk(1, 0)), transform)), List(MeshLodInfo(List(chunk(2, 10)), transform)))
      val info = WebknossosSegmentInfo.fromMeshInfosAndMetadataAllowingNoChunks(chunkInfos, "draco")
      assert(info.map(_.lods.flatMap(_.chunks.map(_.byteOffset))).contains(List(0L, 10L)))
    }
  }
}
