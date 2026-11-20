package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import org.scalatest.wordspec.AnyWordSpec

class CuboidTestSuite extends AnyWordSpec {

  private val origin = VoxelPosition(0, 0, 0, Vec3Int.ones)

  "Cuboid" should {
    "accept regular dimensions" in
      assert(Cuboid(origin, 512, 512, 512).hasValidDimensions)
    "reject volumes that overflow Int" in {
      assert(!Cuboid(origin, 2048, 2048, 1024).hasValidDimensions)
      assert(!Cuboid(origin, 65536, 65536, 1).hasValidDimensions)
    }
    "reject elongated cuboids exceeding the per-axis limit" in {
      assert(Cuboid(origin, Cuboid.maxAxisLength, 1, 1).hasValidDimensions)
      assert(!Cuboid(origin, 512 * 512 * 512, 1, 1).hasValidDimensions)
    }
    "reject bottom right corners that overflow Int" in {
      assert(!Cuboid(VoxelPosition(Int.MaxValue - 10, 0, 0, Vec3Int.ones), 32, 32, 32).hasValidDimensions)
      assert(!Cuboid(VoxelPosition(0, 0, 0, Vec3Int(1 << 20, 1, 1)), 4096, 1, 1).hasValidDimensions)
      assert(!Cuboid(VoxelPosition(Int.MinValue, 0, 0, Vec3Int(1 << 21, 1, 1)), 2047, 1, 1).hasValidDimensions)
    }
  }
}
