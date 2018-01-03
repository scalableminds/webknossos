/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.skeleton

import com.scalableminds.webknossos.datastore.SkeletonTracing.{Node, SkeletonTracing}
import com.scalableminds.webknossos.datastore.tracings.ProtoGeometryImplicits
import com.scalableminds.util.geometry.{Point3D, Vector3D}

object SkeletonTracingDefaults extends ProtoGeometryImplicits {
  val dataSetName = ""
  val trees = Seq()
  def createdTimestamp = System.currentTimeMillis()
  val boundingBox = None
  val activeNodeId = None
  val editPosition = Point3D(0, 0, 0)
  val editRotation = Vector3D(0, 0, 0)
  val zoomLevel = 2.0
  val version = 0
  val userBoundingBox = None

  def createInstance = SkeletonTracing(dataSetName, trees, createdTimestamp, boundingBox, activeNodeId, editPosition, editRotation, zoomLevel, version, userBoundingBox)
}

object NodeDefaults extends ProtoGeometryImplicits {
  val id = 0
  val rotation = Vector3D(0, 0, 0)
  val position = Point3D(0, 0, 0)
  val radius = 120
  val viewport = 1
  val resolution = 1
  val bitDepth = 0
  val interpolation = false
  def createdTimestamp = System.currentTimeMillis()

  def createInstance = Node(id, position, rotation, radius, viewport, resolution, bitDepth, interpolation, createdTimestamp)
}
