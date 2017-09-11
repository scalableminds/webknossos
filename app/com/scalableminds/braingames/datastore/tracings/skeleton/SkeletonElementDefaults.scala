/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.braingames.datastore.geometry.{Point3D, Vector3D}

object SkeletonTracingDefaults {
  def trees = Seq()
  def createdTimestamp = System.currentTimeMillis()
  def boundingBox = None
  def activeNodeId = None
  def editPosition = Point3D(0, 0, 0)
  def editRotation = Vector3D(0, 0, 0)
  def zoomLevel = 2.0
  def version = 0
}

object NodeDefaults {
  val rotation = Vector3D(0, 0, 0)
  val radius = 120
  val viewport = 1
  val resolution = 1
  val bitDepth = 0
  val interpolation = false
}
