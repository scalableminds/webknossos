package backend

import com.scalableminds.webknossos.datastore.services.mesh.FullMeshHelper
import org.scalatest.wordspec.AnyWordSpec

import java.nio.{ByteBuffer, ByteOrder}

class FullMeshHelperTestSuite extends AnyWordSpec {

  private object Helper extends FullMeshHelper {
    def encode(vertexBuffer: Array[Float]): Array[Byte] = adHocMeshToStl(vertexBuffer)
  }

  private type Vec = (Double, Double, Double)
  private type Triangle = (Vec, Vec, Vec)

  private val epsilon = 1e-5
  private val bytesPerFace = 50

  private def sub(a: Vec, b: Vec): Vec = (a._1 - b._1, a._2 - b._2, a._3 - b._3)
  private def dot(a: Vec, b: Vec): Double = a._1 * b._1 + a._2 * b._2 + a._3 * b._3
  private def cross(a: Vec, b: Vec): Vec =
    (a._2 * b._3 - a._3 * b._2, a._3 * b._1 - a._1 * b._3, a._1 * b._2 - a._2 * b._1)
  private def normalize(a: Vec): Vec = {
    val length = Math.sqrt(dot(a, a))
    (a._1 / length, a._2 / length, a._3 / length)
  }
  private def centroid(points: Seq[Vec]): Vec =
    (points.map(_._1).sum / points.length, points.map(_._2).sum / points.length, points.map(_._3).sum / points.length)

  private def toVertexBuffer(triangles: Seq[Triangle]): Array[Float] =
    triangles.flatMap { case (a, b, c) => Seq(a, b, c) }.flatMap(v => Seq(v._1, v._2, v._3)).map(_.toFloat).toArray

  // Returns (normal, vertices) per face, as stored in the STL bytes
  private def decodeFaces(stlBytes: Array[Byte]): Seq[(Vec, Triangle)] = {
    val buffer = ByteBuffer.wrap(stlBytes).order(ByteOrder.LITTLE_ENDIAN)
    def readVec(offset: Int): Vec =
      (buffer.getFloat(offset).toDouble, buffer.getFloat(offset + 4).toDouble, buffer.getFloat(offset + 8).toDouble)
    (0 until stlBytes.length / bytesPerFace).map { faceIndex =>
      val base = faceIndex * bytesPerFace
      (readVec(base), (readVec(base + 12), readVec(base + 24), readVec(base + 36)))
    }
  }

  private def assertClose(actual: Vec, expected: Vec): Unit =
    assert(
      Math.abs(actual._1 - expected._1) < epsilon && Math.abs(actual._2 - expected._2) < epsilon &&
        Math.abs(actual._3 - expected._3) < epsilon,
      s"expected $expected, got $actual"
    )

  // Checks every stored normal against its own face and that it points away from the center of the closed shape
  private def checkClosedShape(triangles: Seq[Triangle]): Unit = {
    val stlBytes = Helper.encode(toVertexBuffer(triangles))
    assert(stlBytes.length == triangles.length * bytesPerFace)
    val faces = decodeFaces(stlBytes)
    val shapeCenter = centroid(triangles.flatMap { case (a, b, c) => Seq(a, b, c) })
    faces.zip(triangles).foreach { case ((storedNormal, storedTriangle), triangle @ (a, b, c)) =>
      assert(storedTriangle == triangle)
      assertClose(storedNormal, normalize(cross(sub(b, a), sub(c, a))))
      assert(dot(storedNormal, sub(centroid(Seq(a, b, c)), shapeCenter)) > 0, s"normal of $triangle points inward")
    }
  }

  // Counter-clockwise (seen from outside) triangles of an axis-aligned box from min to max
  private def boxTriangles(min: Vec, max: Vec): Seq[Triangle] = {
    val (x0, y0, z0) = min
    val (x1, y1, z1) = max
    val quads: Seq[(Vec, Vec, Vec, Vec)] = Seq(
      ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)), // -z
      ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)), // +z
      ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)), // -y
      ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)), // +y
      ((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)), // -x
      ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)) // +x
    )
    quads.flatMap { case (a, b, c, d) => Seq((a, b, c), (a, c, d)) }
  }

  "adHocMeshToStl" should {
    "store each face's own outward normal for a tetrahedron" in {
      val o = (10.0, 20.0, 30.0)
      val x = (13.0, 20.0, 30.0)
      val y = (10.0, 22.0, 30.0)
      val z = (10.0, 20.0, 35.0)
      checkClosedShape(Seq((o, y, x), (o, x, z), (o, z, y), (x, y, z)))
    }

    "store each face's own outward normal for a box" in
      checkClosedShape(boxTriangles((4.0, -2.0, 7.0), (9.0, 1.5, 8.0)))

    "produce no bytes for an empty vertex buffer" in
      assert(Helper.encode(Array.empty).isEmpty)
  }
}
