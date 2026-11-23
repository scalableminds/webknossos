package backend

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.webknossos.datastore.services.mesh.{FullMeshHelper, NativeAdHocMesher}
import org.scalatest.wordspec.AnyWordSpec

import java.nio.{ByteBuffer, ByteOrder}

class FullMeshHelperTestSuite extends AnyWordSpec with FullMeshHelper {

  private type Vec = (Double, Double, Double)

  private def sub(a: Vec, b: Vec): Vec = (a._1 - b._1, a._2 - b._2, a._3 - b._3)
  private def cross(a: Vec, b: Vec): Vec =
    (a._2 * b._3 - a._3 * b._2, a._3 * b._1 - a._1 * b._3, a._1 * b._2 - a._2 * b._1)
  private def dot(a: Vec, b: Vec): Double = a._1 * b._1 + a._2 * b._2 + a._3 * b._3

  "adHocMeshToStl" should {
    "store each face's own outward normal for an ad-hoc mesh" in {
      // An L-shaped segment of four voxels, not touching the border, so marching cubes yields a closed surface
      val dims = Vec3Int(4, 4, 4)
      val segmentVoxels = Set((1, 1, 1), (2, 1, 1), (1, 2, 1), (1, 1, 2))
      val data = Array.tabulate(dims.x * dims.y * dims.z) { i =>
        if (segmentVoxels.contains((i % dims.x, i / dims.x % dims.y, i / (dims.x * dims.y)))) 1.toByte else 0.toByte
      }
      val vertices =
        new NativeAdHocMesher()
          .mesh(data, 1, dims, 1L, Vec3Float(10, 20, 30), Vec3Float(11.24f, 11.24f, 28f))
          .triangleSoup

      val stl = ByteBuffer.wrap(adHocMeshToStl(vertices)).order(ByteOrder.LITTLE_ENDIAN)
      def readVec(offset: Int): Vec =
        (stl.getFloat(offset).toDouble, stl.getFloat(offset + 4).toDouble, stl.getFloat(offset + 8).toDouble)
      val numFaces = vertices.length / 9
      assert(numFaces > 8 && stl.capacity == numFaces * 50)
      val faces = (0 until numFaces).map { faceIndex =>
        val base = faceIndex * 50
        (readVec(base), (readVec(base + 12), readVec(base + 24), readVec(base + 36)))
      }
      val storedCoordinates = faces.flatMap { case (_, (a, b, c)) => Seq(a, b, c) }.flatMap(v => Seq(v._1, v._2, v._3))
      assert(storedCoordinates == vertices.map(_.toDouble).toSeq)

      faces.foreach { case (normal, (a, b, c)) =>
        val faceNormal = cross(sub(b, a), sub(c, a))
        assert(Math.abs(dot(normal, normal) - 1) < 1e-5, s"stored normal $normal is not normalized")
        val cosine = dot(normal, faceNormal) / Math.sqrt(dot(faceNormal, faceNormal))
        assert(cosine > 0.9999, s"stored normal $normal does not belong to face ($a, $b, $c)")
      }

      // The normals match their faces, so they all point outward if the closed surface is oriented consistently
      // (each edge is traversed once in each direction) and encloses a positive volume.
      val directedEdges = faces.flatMap { case (_, (a, b, c)) => Seq((a, b), (b, c), (c, a)) }
      assert(directedEdges.distinct.length == directedEdges.length)
      assert(directedEdges.forall { case (from, to) => directedEdges.contains((to, from)) })
      val signedVolume = faces.map { case (_, (a, b, c)) => dot(a, cross(b, c)) }.sum / 6
      assert(signedVolume > 0)
    }
  }

  "bucketsToMesh" should {
    "add the buckets below each segment bucket, also diagonally" in {
      val buckets = bucketsToMesh(Seq(Vec3Int(5, 5, 5)))
      assert(buckets.toSet == (for {
        x <- 4 to 5
        y <- 4 to 5
        z <- 4 to 5
      } yield Vec3Int(x, y, z)).toSet)
    }

    "list each bucket once and leave out buckets below 0" in {
      val buckets = bucketsToMesh(Seq(Vec3Int(0, 3, 1), Vec3Int(0, 4, 1)))
      assert(buckets.distinct.length == buckets.length)
      assert(
        buckets.toSet == Set(
          Vec3Int(0, 2, 0),
          Vec3Int(0, 2, 1),
          Vec3Int(0, 3, 0),
          Vec3Int(0, 3, 1),
          Vec3Int(0, 4, 0),
          Vec3Int(0, 4, 1)
        )
      )
    }
  }
}
