/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.util.geometry._

import scala.reflect.ClassTag

/**
  * A cuboid data model defines which binary data is responded given a viewpoint and an axis
  */
case class Cuboid(
                   _width: Int,
                   _height: Int,
                   _depth: Int,
                   resolution: Int = 1,
                   topLeft: Point3D) {

  val width = resolution * _width
  val height = resolution * _height
  val depth = resolution * _depth

  val bottomRight = topLeft.dz(depth - 1).dx(width - 1).dy(height - 1)
}

trait CubeIterator {
  def iterateOverCube[T](cube: Cuboid, extendArrayBy: Int = 1)
                        (mappingF: (Double, Double, Double, Int) => Array[T])
                        (implicit c: ClassTag[T]): Array[T] = {

    val xhMax = cube.topLeft.x + cube.width
    val yhMax = cube.topLeft.y + cube.height
    val zhMax = cube.topLeft.z + cube.depth

    val array = new Array[T](cube._width * cube._height * cube._depth * extendArrayBy)
    val resolution = cube.resolution
    var x = cube.topLeft.x
    var y = cube.topLeft.y
    var z = cube.topLeft.z

    var idx = 0
    while (z < zhMax) {
      y = cube.topLeft.y
      while (y < yhMax) {
        x = cube.topLeft.x
        while (x < xhMax) {
          val r = mappingF(x, y, z, idx)
          if (r.length > 0)
            r.copyToArray(array, idx, extendArrayBy)
          x += resolution
          idx += extendArrayBy
        }
        y += resolution
      }
      z += resolution
    }
    array
  }
}