/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

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
                   topLeftOpt: Option[Vector3D] = None,
                   moveVector: (Double, Double, Double) = (0, 0, 0)) {

  val width = resolution * _width
  val height = resolution * _height
  val depth = resolution * _depth

  val topLeft = topLeftOpt getOrElse {
    val xh = (width / 2.0).floor
    val yh = (height / 2.0).floor
    val zh = (depth / 2.0).floor
    Vector3D(-xh, -yh, -zh)
  }

  val corners = simpleMove(moveVector, Array(
                                              topLeft,
                                              topLeft.dx(width - 1),
                                              topLeft.dy(height - 1),
                                              topLeft.dx(width - 1).dy(height - 1),
                                              topLeft.dz(depth - 1),
                                              topLeft.dz(depth - 1).dx(width - 1),
                                              topLeft.dz(depth - 1).dy(height - 1),
                                              topLeft.dz(depth - 1).dx(width - 1).dy(height - 1)))

  val maxCorner = corners.foldLeft((0.0, 0.0, 0.0))((b, e) => (
    math.max(b._1, e.x), math.max(b._2, e.y), math.max(b._3, e.z)))

  val minCorner = corners.foldLeft(maxCorner)((b, e) => (
    math.min(b._1, e.x), math.min(b._2, e.y), math.min(b._3, e.z)))

  private def simpleMove(moveVector: (Double, Double, Double), coordinates: Array[Vector3D]): Array[Vector3D] = {
    val move = Vector3D(moveVector)
    coordinates.map(_ + move)
  }
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

    val (dx, dy, dz) = cube.moveVector

    var idx = 0
    while (z < zhMax) {
      y = cube.topLeft.y
      while (y < yhMax) {
        x = cube.topLeft.x
        while (x < xhMax) {
          val r = mappingF(dx + x, dy + y, dz + z, idx)
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