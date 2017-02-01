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

  val width: Int = resolution * _width
  val height: Int = resolution * _height
  val depth: Int = resolution * _depth

  val voxelVolume: Int =
    _width * _height * _depth
}