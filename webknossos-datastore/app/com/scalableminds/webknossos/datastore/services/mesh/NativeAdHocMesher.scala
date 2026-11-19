package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.webknossos.datastore.helpers.NativeLibrary

import java.nio.{ByteBuffer, ByteOrder}

/** An indexed triangle mesh of one segment in a cuboid.
  *
  * @param vertices
  *   three floats per vertex, each vertex once
  * @param indices
  *   three vertex indices per triangle
  * @param neighbors
  *   the faces of the cuboid that contain the segment: front xy (z = 0), front xz (y = 0), front yz (x = 0), back xy,
  *   back xz, back yz
  */
case class AdHocMesh(vertices: Array[Float], indices: Array[Int], neighbors: List[Int]) {
  def vertexCount: Int = vertices.length / 3

  /** Three floats per vertex and three vertices per triangle, without shared vertices. */
  def triangleSoup: Array[Float] = {
    val soup = new Array[Float](indices.length * 3)
    indices.indices.foreach { i =>
      System.arraycopy(vertices, indices(i) * 3, soup, i * 3, 3)
    }
    soup
  }

  /** The response body of an ad-hoc mesh request, little-endian.
    *
    * Indexed: the vertices as floats, followed by the indices as unsigned 16-bit integers if there are at most 65535
    * vertices, else as 32-bit integers. Not 65536, because WebGL 2 treats the 16-bit index 65535 as primitive restart.
    * Otherwise: the triangle soup as floats.
    */
  def toBytes(indexed: Boolean): Array[Byte] =
    if (indexed) {
      val indexBytes = if (vertexCount <= AdHocMesh.maxVertexCountForShortIndices) 2 else 4
      val buffer = ByteBuffer.allocate(vertices.length * 4 + indices.length * indexBytes).order(ByteOrder.LITTLE_ENDIAN)
      buffer.asFloatBuffer().put(vertices)
      buffer.position(vertices.length * 4)
      if (indexBytes == 2) indices.foreach(index => buffer.putShort(index.toShort))
      else buffer.asIntBuffer().put(indices)
      buffer.array()
    } else {
      val soup = triangleSoup
      val buffer = ByteBuffer.allocate(soup.length * 4).order(ByteOrder.LITTLE_ENDIAN)
      buffer.asFloatBuffer().put(soup)
      buffer.array()
    }

  /** The headers of a response with the body [[toBytes]]: the neighbors (see [[neighbors]]) and, only if indexed, the
    * vertex count, which locates the indices. So the header is present exactly if the body is indexed.
    */
  def responseHeaders(indexed: Boolean): List[(String, String)] =
    if (indexed)
      List(
        "NEIGHBORS" -> neighbors.mkString("[", ", ", "]"),
        "Vertex-Count" -> vertexCount.toString,
        "Access-Control-Expose-Headers" -> "NEIGHBORS, Vertex-Count"
      )
    else
      List("NEIGHBORS" -> neighbors.mkString("[", ", ", "]"), "Access-Control-Expose-Headers" -> "NEIGHBORS")
}

object AdHocMesh {
  val maxVertexCountForShortIndices: Int = 65535
}

class NativeAdHocMesher {
  NativeLibrary.ensureLoaded()

  /** Meshes the voxels of one segment in a cuboid with marching cubes (webknossos-native/src/ad_hoc_mesh.rs).
    *
    * @param data
    *   the cuboid as little-endian elements, x fastest
    * @param segmentId
    *   compared with the raw bits of each element, so only its low bytesPerElement bytes matter
    * @param neighborsOut
    *   receives in its only element the faces of the cuboid that contain the segment, as a bit mask (see
    *   [[neighborFaces]])
    * @param indicesOut
    *   receives in its only element the vertex indices, three per triangle
    * @return
    *   three floats per vertex, each vertex once: (voxel + edge midpoint + offset) * scale
    */
  @native def adHocMesh(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Array[Int],
      segmentId: Long,
      offset: Array[Float],
      scale: Array[Float],
      neighborsOut: Array[Int],
      indicesOut: Array[Array[Int]]
  ): Array[Float]

  def mesh(
      data: Array[Byte],
      bytesPerElement: Int,
      dimensions: Vec3Int,
      segmentId: Long,
      offset: Vec3Float,
      scale: Vec3Float
  ): AdHocMesh = {
    val neighborsOut = new Array[Int](1)
    val indicesOut = new Array[Array[Int]](1)
    val vertices = adHocMesh(
      data,
      bytesPerElement,
      Array(dimensions.x, dimensions.y, dimensions.z),
      segmentId,
      Array(offset.x, offset.y, offset.z),
      Array(scale.x, scale.y, scale.z),
      neighborsOut,
      indicesOut
    )
    AdHocMesh(vertices, indicesOut(0), neighborFaces(neighborsOut(0)))
  }

  private def neighborFaces(neighborMask: Int): List[Int] =
    (0 until 6).filter(face => (neighborMask & (1 << face)) != 0).toList
}
