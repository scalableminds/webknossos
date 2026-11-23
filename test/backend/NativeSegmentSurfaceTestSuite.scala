package backend

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.services.mesh.{NativeSegmentSurface, SegmentSurface, SurfaceChunk}
import org.scalatest.wordspec.AnyWordSpec

// Exercises the JNI glue of the native surface measurement (symbol name, argument order, result). The measurement itself
// is covered by the Rust tests in webknossos-native/src/segment_surface/tests.rs.
class NativeSegmentSurfaceTestSuite extends AnyWordSpec {

  private val segmentSurface = new NativeSegmentSurface()

  // A 3³ cuboid of uint8 elements that are 7 at (1, 1, 1) and 0 elsewhere.
  private val singleVoxel = Array.tabulate[Byte](27)(i => if (i == 13) 7.toByte else 0.toByte)

  "NativeSegmentSurface" should {
    "measure a single voxel as the octahedron of its marching cubes surface" in {
      val surface =
        segmentSurface.measureSurface(singleVoxel, 1, Vec3Int(3, 3, 3), 7L, Vec3Int(0, 0, 0), Vec3Int(3, 3, 3), Vec3Double(2, 3, 4))
      // Eight triangles at the midpoints of the voxel's edges: sqrt(a²b² + a²c² + b²c²) for a voxel of size a × b × c.
      assert(Math.abs(surface.area - Math.sqrt(4 * 9 + 4 * 16 + 9 * 16)) < 1e-9)
      assert(surface.voxelCount == 1)
    }

    "only count the voxels in the interior, but the cubes touching it" in {
      // The interior is the voxel at x = 2: the cubes around the segment voxel at x = 1 touch it, but contain no
      // segment voxel of the interior, so they do not count.
      val outside =
        segmentSurface.measureSurface(singleVoxel, 1, Vec3Int(3, 3, 3), 7L, Vec3Int(2, 0, 0), Vec3Int(3, 3, 3), Vec3Double(1, 1, 1))
      assert(outside == SegmentSurface(0.0, 0L))
      val other =
        segmentSurface.measureSurface(singleVoxel, 1, Vec3Int(3, 3, 3), 8L, Vec3Int(0, 0, 0), Vec3Int(3, 3, 3), Vec3Double(1, 1, 1))
      assert(other == SegmentSurface(0.0, 0L))
    }

    "throw a RuntimeException naming the function for invalid arguments" in {
      val error = intercept[RuntimeException] {
        segmentSurface.measureSurface(singleVoxel, 1, Vec3Int(3, 3, 3), 7L, Vec3Int(0, 0, 0), Vec3Int(4, 3, 3), Vec3Double(1, 1, 1))
      }
      assert(error.getMessage.contains("SegmentSurface measure"))
      assert(error.getMessage.contains("interiorEnd <= dimensions"))
    }
  }

  "SurfaceChunk.forBucket" should {
    "extend the bucket by one voxel on each side" in {
      assert(
        SurfaceChunk.forBucket(Vec3Int(2, 3, 4)) ==
          SurfaceChunk(Vec3Int(63, 95, 127), Vec3Int(34, 34, 34), Vec3Int(1, 1, 1), Vec3Int(33, 33, 33))
      )
    }

    "not extend the bucket below 0" in {
      assert(
        SurfaceChunk.forBucket(Vec3Int(0, 1, 0)) ==
          SurfaceChunk(Vec3Int(0, 31, 0), Vec3Int(33, 34, 33), Vec3Int(0, 1, 0), Vec3Int(32, 33, 32))
      )
    }
  }
}
