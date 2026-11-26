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

    "encode the vertices followed by 16-bit indices" in {
      val bytes = mesh.toBytes
      assert(bytes.length == 12 * 4 + 6 * 2)
      assert(floats(bytes, 0, 12) == mesh.vertices.toSeq)
      val indices = littleEndian(bytes, 48, 12).slice().order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      assert((0 until 6).map(indices.get(_).toInt) == mesh.indices.toSeq)
      assert(mesh.responseHeaders.contains("Vertex-Count" -> "4"))
      assert(mesh.responseHeaders.contains("NEIGHBORS" -> "[2, 5]"))
    }

    "use 16-bit indices up to 65535 vertices and 32-bit indices above" in {
      // 16-bit index 65535 is the WebGL 2 primitive restart index, so it must not occur.
      def meshWithVertexCount(count: Int) =
        AdHocMesh(new Array[Float](count * 3), Array(0, count - 1, count / 2), List())
      val short = meshWithVertexCount(65535).toBytes
      assert(short.length == 65535 * 12 + 3 * 2)
      assert((littleEndian(short, 65535 * 12 + 2, 2).getShort & 0xffff) == 65534)
      val int = meshWithVertexCount(65536).toBytes
      assert(int.length == 65536 * 12 + 3 * 4)
      assert(littleEndian(int, 65536 * 12 + 4, 4).getInt == 65535)
    }
  }
}
