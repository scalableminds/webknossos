package brainflight.tools

import brainflight.tools.geometry.Vector3D

object Interpolator {
  def triLerp(d: Vector3D, p: Array[Double]): Double = {
    p(0) * (1 - d.x) * (1 - d.y) * (1 - d.z) +
      p(4) * d.x * (1 - d.y) * (1 - d.z) +
      p(2) * (1 - d.x) * d.y * (1 - d.z) +
      p(6) * d.x * d.y * (1 - d.z) +
      p(1) * (1 - d.x) * (1 - d.y) * d.z +
      p(5) * d.x * (1 - d.y) * d.z +
      p(3) * (1 - d.x) * d.y * d.z +
      p(7) * d.x * d.y * d.z
  }

  def linearInterpolation(d: List[Double], q: List[Double]): Double = {
    if (d.isEmpty) q.head
    else if (math.pow(2, d.size) == q.size) {
      val firstHalf = q.take(q.size / 2)
      val secondHalf = q.takeRight(q.size / 2)
      linearInterpolation(d.tail, firstHalf.zip(secondHalf).map(v => v._1 * (1 - d.head) + v._2 * d.head))
    } else
      throw new IllegalArgumentException("there must be 2^n values in q, where n is the dimension of the interpolation")
  }
}