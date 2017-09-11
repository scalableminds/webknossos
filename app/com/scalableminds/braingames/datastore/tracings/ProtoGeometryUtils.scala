/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.scalableminds.braingames.datastore.geometry.{BoundingBox, Point3D, Vector3D}

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

  private def bottomRight(aBoundingBox: BoundingBox) = Point3DUtils.move(aBoundingBox.topLeft, aBoundingBox.width, aBoundingBox.height, aBoundingBox.depth)

  def convert(b: com.scalableminds.util.geometry.BoundingBox) =
    BoundingBox(Point3DUtils.convert(b.topLeft), b.width, b.height, b.depth)

  def convertOpt(bOpt: Option[com.scalableminds.util.geometry.BoundingBox]) = bOpt match {
    case Some(b) => Some(convert(b))
    case None => None
  }
}

object Point3DUtils {

  def move(aPoint: Point3D, dx: Int, dy: Int, dz: Int) =
    Point3D(aPoint.x + dx, aPoint.y + dy, aPoint.z + dz)

  def convert(aPoint: com.scalableminds.util.geometry.Point3D) =
    Point3D(aPoint.x, aPoint.y, aPoint.z)

  def convertOpt(aPointOpt: Option[com.scalableminds.util.geometry.Point3D]) = aPointOpt match {
    case Some(aPoint) => Some(convert(aPoint))
    case None => None
  }

  def convertBack(aPoint: Point3D) =
    com.scalableminds.util.geometry.Point3D(aPoint.x, aPoint.x, aPoint.z)

}

object Vector3DUtils {
  def convert(aVector: com.scalableminds.util.geometry.Vector3D) =
    Vector3D(aVector.x, aVector.y, aVector.z)

  def convertOpt(aVectorOpt: Option[com.scalableminds.util.geometry.Vector3D]) = aVectorOpt match {
    case Some(aVector) => Some(convert(aVector))
    case None => None
  }

  def convertBack(aVector: Vector3D) =
    com.scalableminds.util.geometry.Vector3D(aVector.x, aVector.y, aVector.z)
}

