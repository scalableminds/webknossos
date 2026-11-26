package backend

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.services.mesh.{
  NativeSegmentSurface,
  SegmentSurfaceWithVolume,
  SurfaceChunk
}
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
        segmentSurface.measureSurface(
          singleVoxel,
          1,
          Vec3Int(3, 3, 3),
          7L,
          Vec3Int(0, 0, 0),
          Vec3Int(3, 3, 3),
          Vec3Double(2, 3, 4)
        )
      // Eight triangles at the midpoints of the voxel's edges: sqrt(a²b² + a²c² + b²c²) for a voxel of size a × b × c.
      assert(Math.abs(surface.area - Math.sqrt(4 * 9 + 4 * 16 + 9 * 16)) < 1e-9)
      assert(surface.voxelCount == 1)
    }

    "only count the voxels in the interior, but the cubes touching it" in {
      // The interior is the voxel at x = 2: the cubes around the segment voxel at x = 1 touch it, but contain no
      // segment voxel of the interior, so they do not count.
      val outside =
        segmentSurface.measureSurface(
          singleVoxel,
          1,
          Vec3Int(3, 3, 3),
          7L,
          Vec3Int(2, 0, 0),
          Vec3Int(3, 3, 3),
          Vec3Double(1, 1, 1)
        )
      assert(outside == SegmentSurfaceWithVolume(0.0, 0L))
      val other =
        segmentSurface.measureSurface(
          singleVoxel,
          1,
          Vec3Int(3, 3, 3),
          8L,
          Vec3Int(0, 0, 0),
          Vec3Int(3, 3, 3),
          Vec3Double(1, 1, 1)
        )
      assert(other == SegmentSurfaceWithVolume(0.0, 0L))
    }

    "throw a RuntimeException naming the function for invalid arguments" in {
      val error = intercept[RuntimeException] {
        segmentSurface.measureSurface(
          singleVoxel,
          1,
          Vec3Int(3, 3, 3),
          7L,
          Vec3Int(0, 0, 0),
          Vec3Int(4, 3, 3),
          Vec3Double(1, 1, 1)
        )
      }
      assert(error.getMessage.contains("SegmentSurface measure"))
      assert(error.getMessage.contains("interiorEnd <= dimensions"))
    }
  }

  "SurfaceChunk.forBucket" should {
    "extend the bucket by one voxel on each side" in
      assert(
        SurfaceChunk.forBucket(Vec3Int(2, 3, 4)) ==
          SurfaceChunk(Vec3Int(63, 95, 127), Vec3Int(34, 34, 34), Vec3Int(1, 1, 1), Vec3Int(33, 33, 33))
      )

    "not extend the bucket below 0" in
      assert(
        SurfaceChunk.forBucket(Vec3Int(0, 1, 0)) ==
          SurfaceChunk(Vec3Int(0, 31, 0), Vec3Int(33, 34, 33), Vec3Int(0, 1, 0), Vec3Int(32, 33, 32))
      )
  }

  "SurfaceChunk.forSegmentBuckets" should {
    "measure a group of 2×2×2 buckets as one chunk if it has at least four buckets of the segment" in {
      val group = Seq(Vec3Int(2, 2, 2), Vec3Int(3, 2, 2), Vec3Int(2, 3, 2), Vec3Int(3, 3, 3))
      assert(
        SurfaceChunk.forSegmentBuckets(group) ==
          Seq(SurfaceChunk(Vec3Int(63, 63, 63), Vec3Int(66, 66, 66), Vec3Int(1, 1, 1), Vec3Int(65, 65, 65)))
      )
    }

    "keep the buckets of a thin segment as single chunks" in {
      val axon = (0 until 6).map(x => Vec3Int(x, 3, 3))
      assert(SurfaceChunk.forSegmentBuckets(axon).toSet == axon.map(SurfaceChunk.forBucket).toSet)
    }

    "give every voxel of the segment to exactly one chunk" in {
      val blob = for {
        x <- 0 until 3
        y <- 0 until 3
        z <- 0 until 2
      } yield Vec3Int(x, y, z)
      val segmentBuckets = blob :+ Vec3Int(5, 0, 0)
      val interiors = SurfaceChunk.forSegmentBuckets(segmentBuckets).map { chunk =>
        val start = chunk.topLeft + chunk.interiorStart
        val end = chunk.topLeft + chunk.interiorEnd
        (start, end)
      }
      def owners(voxel: Vec3Int): Int = interiors.count { case (start, end) =>
        start.x <= voxel.x && voxel.x < end.x && start.y <= voxel.y && voxel.y < end.y && start.z <= voxel.z &&
        voxel.z < end.z
      }
      segmentBuckets.foreach { bucket =>
        val corner = bucket * DataLayer.bucketLength
        assert(owners(corner) == 1)
        assert(owners(corner + Vec3Int.full(DataLayer.bucketLength - 1)) == 1)
      }
      // The groups at (0, 0, 0) (8 buckets of the segment), (1, 0, 0) and (0, 1, 0) (4 each), not (1, 1, 0) (2).
      assert(SurfaceChunk.forSegmentBuckets(segmentBuckets).count(_.size.x > 34) == 3)
    }
  }
}
