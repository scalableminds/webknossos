/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.scalableminds.braingames.datastore.tracings.skeleton.elements.Tree
import com.scalableminds.braingames.datastore.tracings.volume.Volume
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}

trait Tracing {

  def id: String

  def dataSetName: String

  def trees: List[Tree] = Nil

  def volumes: List[Volume] = Nil

  def editPosition: Point3D

  def editRotation: Vector3D

  def zoomLevel: Double

  def boundingBox: Option[BoundingBox]

  def version: Long

  def timestamp: Long

  override def toString = s"<tracing $id>"
}
