package braingames.util

import braingames.geometry.Vector3D

object Interpolator {
  def triLerp(d: Vector3D, p: Array[Array[Double]], elements: Int): Array[Double] = {
    var e = 0
    val r = new Array[Double](elements)
    while(e < elements){
      r(e) =
        p(0)(e) * (1 - d.x) * (1 - d.y) * (1 - d.z) +
        p(4)(e) * d.x * (1 - d.y) * (1 - d.z) +
        p(2)(e) * (1 - d.x) * d.y * (1 - d.z) +
        p(6)(e) * d.x * d.y * (1 - d.z) +
        p(1)(e) * (1 - d.x) * (1 - d.y) * d.z +
        p(5)(e) * d.x * (1 - d.y) * d.z +
        p(3)(e) * (1 - d.x) * d.y * d.z +
        p(7)(e) * d.x * d.y * d.z
      e+=1
    }
    r
  }
}