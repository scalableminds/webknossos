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
  topLeft: Point3D,
  width: Int,
  height: Int,
  depth: Int,
  resolutionExponent: Int = 0) {

  lazy val resolution: Int =
    math.pow(2, resolutionExponent).toInt

  val voxelVolume: Int =
    width * height * depth
}