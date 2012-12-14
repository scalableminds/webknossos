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
}