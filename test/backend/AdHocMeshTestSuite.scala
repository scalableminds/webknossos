package backend

import com.scalableminds.webknossos.datastore.services.mesh.AdHocMesh
import org.scalatest.wordspec.AnyWordSpec

import java.nio.{ByteBuffer, ByteOrder}

class AdHocMeshTestSuite extends AnyWordSpec {

  private def littleEndian(bytes: Array[Byte], from: Int, length: Int): ByteBuffer =
    ByteBuffer.wrap(bytes, from, length).order(ByteOrder.LITTLE_ENDIAN)

  private def floats(bytes: Array[Byte], from: Int, count: Int): Seq[Float] = {
    val result = new Array[Float](count)
    littleEndian(bytes, from, count * 4).asFloatBuffer().get(result)
    result.toSeq
  }

  "AdHocMesh" should {
    val mesh = AdHocMesh(
      vertices = Array(0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f),
      indices = Array(0, 1, 2, 0, 3, 1),
      neighbors = List(2, 5)
    )

    "resolve the indices to a triangle soup" in
      assert(mesh.triangleSoup.toSeq == Seq(0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 0f, 1f, 1f, 0f, 0f))

    "encode the triangle soup unless indexed" in {
      val bytes = mesh.toBytes(indexed = false)
      assert(bytes.length == 18 * 4)
      assert(floats(bytes, 0, 18) == mesh.triangleSoup.toSeq)
    }

    "encode the vertices followed by 16-bit indices if indexed" in {
      val bytes = mesh.toBytes(indexed = true)
      assert(bytes.length == 12 * 4 + 6 * 2)
      assert(floats(bytes, 0, 12) == mesh.vertices.toSeq)
      val indices = littleEndian(bytes, 48, 12).slice().order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      assert((0 until 6).map(indices.get(_).toInt) == mesh.indices.toSeq)
      assert(mesh.responseHeaders.contains("VERTEX_COUNT" -> "4"))
      assert(mesh.responseHeaders.contains("NEIGHBORS" -> "[2, 5]"))
    }

    "use 16-bit indices up to 65536 vertices and 32-bit indices above" in {
      def meshWithVertexCount(count: Int) =
        AdHocMesh(new Array[Float](count * 3), Array(0, count - 1, count / 2), List())
      val short = meshWithVertexCount(65536).toBytes(indexed = true)
      assert(short.length == 65536 * 12 + 3 * 2)
      assert((littleEndian(short, 65536 * 12 + 2, 2).getShort & 0xffff) == 65535)
      val int = meshWithVertexCount(65537).toBytes(indexed = true)
      assert(int.length == 65537 * 12 + 3 * 4)
      assert(littleEndian(int, 65537 * 12 + 4, 4).getInt == 65536)
    }
  }
}
