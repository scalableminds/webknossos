package braingames.util

import braingames.geometry.Point3D
import scala.reflect.ClassTag

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 13.06.13
 * Time: 22:59
 */
case class BlockedArray3D[T](
  underlying: Vector[Array[T]],
  blockWidth: Int,
  blockHeight: Int,
  blockDepth: Int,
  xBlocks: Int,
  yBlocks: Int,
  zBlocks: Int,
  elementSize: Int) {

  def getBytes(p: Point3D, block: Array[T])(implicit c: ClassTag[T]) = {
    val address =
      (p.x % blockWidth +
        p.y % blockHeight * blockWidth +
        p.z % blockDepth * blockHeight * blockWidth) * elementSize
    //println(this + " point " + p)
    //println(this + " address " + address)
    val bytes = new Array[T](elementSize)
    var i = 0
    while (i < elementSize) {
      bytes.update(i, block(address + i))
      i += 1
    }
    bytes
  }

  def apply(p: Point3D)(implicit c: ClassTag[T]) = {
    //println(s"p: $p depth: $blockDepth w: $blockWidth h: $blockHeight")
    val blockIdx =
      p.z / blockDepth +
        p.y / blockHeight * zBlocks +
        p.x / blockWidth * zBlocks * yBlocks

    getBytes(p, underlying(blockIdx))
  }
}
