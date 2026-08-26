package backend

import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeVersioningBenchmarkService as Benchmark
import org.scalatest.wordspec.AnyWordSpec

import java.nio.{ByteBuffer, ByteOrder}

/** Correctness tests for the diff codec behind the volume versioning benchmark (POST
  * /tracings/benchmark/volumeVersioning). A benchmark that folds diffs incorrectly would measure the wrong work, so the
  * codec is pinned down here.
  *
  * The benchmark itself is not run from a test — it needs a live FossilDB and writes gigabytes into it. Run it against
  * a deployed tracingstore instead.
  */
class VolumeVersioningBenchmarkSuite extends AnyWordSpec {

  private val BytesPerVoxel = 4
  private val VoxelsPerBucket = 32 * 32 * 32
  private val BucketBytes = VoxelsPerBucket * BytesPerVoxel

  private def at(bucket: Array[Byte], voxel: Int): Int =
    ByteBuffer.wrap(bucket, voxel * BytesPerVoxel, BytesPerVoxel).order(ByteOrder.LITTLE_ENDIAN).getInt

  "The benchmark's diff codec" should {

    "write exactly the voxels its runs cover" in {
      val bucket = new Array[Byte](BucketBytes)
      val runs = Seq((0, 4), (100, 3), (VoxelsPerBucket - 2, 2))
      Benchmark.applyDiff(bucket, Benchmark.encodeDiff(runs, 0x2aL), BytesPerVoxel)

      val covered = runs.flatMap { case (start, length) => start until (start + length) }.toSet
      val written = (0 until VoxelsPerBucket).filter(v => at(bucket, v) != 0).toSet
      assert(written == covered, "diff must touch exactly the voxels its runs cover")
      covered.foreach(v => assert(at(bucket, v) == 0x2a, s"voxel $v holds ${at(bucket, v)}"))
    }

    "apply later diffs over earlier ones" in {
      val bucket = new Array[Byte](BucketBytes)
      Benchmark.applyDiff(bucket, Benchmark.encodeDiff(Seq((10, 5)), 7L), BytesPerVoxel)
      Benchmark.applyDiff(bucket, Benchmark.encodeDiff(Seq((12, 5)), 9L), BytesPerVoxel)
      assert(at(bucket, 10) == 7, "untouched by the second diff")
      assert(at(bucket, 12) == 9, "overwritten by the second diff")
      assert(at(bucket, 16) == 9, "written only by the second diff")
    }

    "encode the value little-endian at every supported width" in {
      for (width <- Seq(1, 2, 4, 8)) {
        val bucket = new Array[Byte](VoxelsPerBucket * width)
        Benchmark.applyDiff(bucket, Benchmark.encodeDiff(Seq((3, 2)), 0x41L), width)
        assert(bucket(3 * width) == 0x41.toByte, s"width $width: low byte at the run start")
        assert(bucket(2 * width) == 0.toByte, s"width $width: voxel before the run untouched")
      }
    }

    "clamp runs that would overflow the bucket" in {
      val bucket = new Array[Byte](BucketBytes)
      // A corrupt or hostile diff must not write out of bounds.
      Benchmark.applyDiff(bucket, Benchmark.encodeDiff(Seq((VoxelsPerBucket - 1, 50)), 5L), BytesPerVoxel)
      assert(at(bucket, VoxelsPerBucket - 1) == 5)
    }
  }

  "Benchmark parameters" should {
    "reject a run that would write more than the cap" in {
      val result = Benchmark.Params.fromQuery(Some(10000), Some(10000), None, None, None, None, None, None)
      assert(result.isLeft, "an oversized run must be refused")
    }

    "reject nonsensical values" in {
      assert(Benchmark.Params.fromQuery(Some(0), None, None, None, None, None, None, None).isLeft)
      assert(Benchmark.Params.fromQuery(None, None, None, Some(3), None, None, None, None).isLeft, "bytesPerVoxel 3")
      assert(Benchmark.Params.fromQuery(None, None, None, None, None, Some(99), None, None).isLeft, "runLength > 32")
    }

    "accept defaults" in {
      val result = Benchmark.Params.fromQuery(None, None, None, None, None, None, None, None)
      assert(result.isRight, s"defaults must be valid, got $result")
    }
  }
}
