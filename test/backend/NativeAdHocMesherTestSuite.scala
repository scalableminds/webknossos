package backend

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.webknossos.datastore.services.mesh.NativeAdHocMesher
import org.scalatest.wordspec.AnyWordSpec

import java.nio.{ByteBuffer, ByteOrder}

// Exercises the JNI glue of the native ad-hoc mesher (symbol name, argument order, neighborsOut, indicesOut). The meshing
// itself is covered by the Rust tests in webknossos-native/src/ad_hoc_mesh/tests.rs.
class NativeAdHocMesherTestSuite extends AnyWordSpec {

  private val mesher = new NativeAdHocMesher()

  private val dimensions = Vec3Int(3, 3, 3)
  private val origin = Vec3Float(0f, 0f, 0f)
  private val unit = Vec3Float(1f, 1f, 1f)

  // A 3³ cuboid of little-endian uint64 elements that are `segmentId` at `voxel` and 0 elsewhere.
  private def uint64Cuboid(segmentId: Long, voxel: Vec3Int): Array[Byte] = {
    val buffer = ByteBuffer.allocate(3 * 3 * 3 * 8).order(ByteOrder.LITTLE_ENDIAN)
    for {
      z <- 0 until 3
      y <- 0 until 3
      x <- 0 until 3
    } buffer.putLong(if (Vec3Int(x, y, z) == voxel) segmentId else 0L)
    buffer.array()
  }

  private def vertexSet(vertices: Array[Float]): Set[(Float, Float, Float)] =
    vertices.grouped(3).map { case Array(x, y, z) => (x, y, z) }.toSet

  "NativeAdHocMesher" should {
    "mesh a single voxel with offset and scale" in {
      val data = Array.tabulate[Byte](27)(i => if (i == 13) 7.toByte else 0.toByte) // voxel (1, 1, 1)
      val mesh = mesher.mesh(data, 1, dimensions, 7L, Vec3Float(10f, 20f, 30f), Vec3Float(2f, 3f, 4f))

      // Each of the 8 cubes around the voxel emits one triangle that cuts off the voxel's corner.
      assert(mesh.indices.length == 8 * 3)
      // The triangle vertices are the midpoints of the 6 edges that leave the voxel, each stored once.
      val expected =
        Set((0.5f, 1f, 1f), (1.5f, 1f, 1f), (1f, 0.5f, 1f), (1f, 1.5f, 1f), (1f, 1f, 0.5f), (1f, 1f, 1.5f)).map {
          case (x, y, z) => ((x + 10f) * 2f, (y + 20f) * 3f, (z + 30f) * 4f)
        }
      assert(mesh.vertexCount == 6)
      assert(vertexSet(mesh.vertices) == expected)
      assert(mesh.indices.toSet == (0 until 6).toSet)
      assert(vertexSet(mesh.triangleSoup) == expected)
      assert(mesh.neighbors.isEmpty)
    }

    "report the faces that contain the segment, for uint64 ids with the top bit set" in {
      val segmentId = Long.MinValue + 5 // 2^63 + 5 as uint64
      val front = mesher.mesh(uint64Cuboid(segmentId, Vec3Int(0, 1, 1)), 8, dimensions, segmentId, origin, unit)
      assert(front.indices.nonEmpty)
      assert(front.neighbors == List(2)) // front yz

      val back = mesher.mesh(uint64Cuboid(segmentId, Vec3Int(2, 1, 1)), 8, dimensions, segmentId, origin, unit)
      assert(back.neighbors == List(5)) // back yz

      val other = mesher.mesh(uint64Cuboid(segmentId, Vec3Int(0, 1, 1)), 8, dimensions, 5L, origin, unit)
      assert(other.vertices.isEmpty && other.indices.isEmpty && other.neighbors.isEmpty)
    }

    "throw a RuntimeException naming the function for invalid arguments" in {
      val error = intercept[RuntimeException] {
        mesher.mesh(new Array[Byte](26), 1, dimensions, 1L, origin, unit)
      }
      assert(error.getMessage.contains("AdHocMesher adHocMesh"))
      assert(error.getMessage.contains("data length"))
    }
  }
}
