package braingames.binary.models

import braingames.geometry.Point3D
import braingames.geometry.Vector3D

trait DataLayerLike {

  def baseDir: String

  def bytesPerElement: Int

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte]
}