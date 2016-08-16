/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import com.scalableminds.util.geometry._
import scala.reflect.ClassTag

/**
 * All possible data models the client should be able to request need to be defined here and registered in Boot.scala
 * A binary data model defines which binary data is responded given a viewpoint and an axis
 */

abstract class DataModel {

  protected def simpleMove(
    moveVector: (Double, Double, Double),
    coordinates: Array[Vector3D]): Array[Vector3D] = {

    def ff(f: (Double, Double, Double, Int) => Array[Vector3D]): Array[Vector3D] = {
      coordinates.map(c => f(c.x, c.y, c.z, 0)(0))
    }

    simpleMove[Vector3D](moveVector, ff)((x, y, z, idx) => Array(Vector3D(x, y, z)))
  }

  @inline
  protected def simpleMove[T](moveVector: (Double, Double, Double), coordinates: ((Double, Double, Double, Int) => Array[T]) => Array[T])
                             (f: (Double, Double, Double, Int) => Array[T]): Array[T] = {
    coordinates { (px, py, pz, idx) =>
      val x = moveVector._1 + px
      val y = moveVector._2 + py
      val z = moveVector._3 + pz
      f(x, y, z, idx)
    }
  }

  // calculate all coordinates which are in the model boundary
  def withContainingCoordinates[T](extendArrayBy: Int = 1)(f: (Double, Double, Double, Int) => Array[T])(implicit c: ClassTag[T]): Array[T]
}

case class Cuboid(
    _width: Int,
    _height: Int,
    _depth: Int,
    resolution: Int = 1,
    topLeftOpt: Option[Vector3D] = None,
    moveVector: (Double, Double, Double) = (0, 0, 0)) extends DataModel {

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

  @inline
  private def looper[T](extendArrayBy: Int, c: ClassTag[T])(f: (Double, Double, Double, Int) => Array[T]) = {
    implicit val tag = c
    val xhMax = topLeft.x + width
    val yhMax = topLeft.y + height
    val zhMax = topLeft.z + depth

    val array = new Array[T](_width * _height * _depth * extendArrayBy)
    var x = topLeft.x
    var y = topLeft.y
    var z = topLeft.z
    var idx = 0
    while (z < zhMax) {
      y = topLeft.y
      while (y < yhMax) {
        x = topLeft.x
        while (x < xhMax) {
          val r = f(x, y, z, idx)
          if(r.length > 0)
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

  override def withContainingCoordinates[T](extendArrayBy: Int = 1)(f: (Double, Double, Double, Int) => Array[T])(implicit c: ClassTag[T]): Array[T] = {
    simpleMove[T](moveVector, looper[T](extendArrayBy, c))(f)
  }
}