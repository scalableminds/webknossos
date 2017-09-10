/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.scalableminds.braingames.datastore.geometry.{BoundingBox, Point3D}

object BoundingBoxUtils {
  def mergeTwoOpt(aOpt: Option[BoundingBox], bOpt: Option[BoundingBox]) =
    for {
      a <- aOpt
      b <- bOpt
    } yield mergeTwo(a, b)

  def mergeTwo(aBoundingBox: BoundingBox, anotherBoundingBox: BoundingBox) = {

    val x = math.min(aBoundingBox.topLeft.x, anotherBoundingBox.topLeft.x)
    val y = math.min(aBoundingBox.topLeft.y, anotherBoundingBox.topLeft.y)
    val z = math.min(aBoundingBox.topLeft.z, anotherBoundingBox.topLeft.z)

    val w = math.max(bottomRight(aBoundingBox).x, bottomRight(anotherBoundingBox).x) - x
    val h = math.max(bottomRight(aBoundingBox).y, bottomRight(anotherBoundingBox).y) - y
    val d = math.max(bottomRight(aBoundingBox).z, bottomRight(anotherBoundingBox).z) - z

    BoundingBox(Point3D(x, y, z), w, h, d)
  }

  private def movePoint(aPoint: Point3D, dx: Int, dy: Int, dz: Int) = Point3D(aPoint.x + dx, aPoint.y + dy, aPoint.z + dz)

  private def bottomRight(aBoundingBox: BoundingBox) = movePoint(aBoundingBox.topLeft, aBoundingBox.width, aBoundingBox.height, aBoundingBox.depth)
}
