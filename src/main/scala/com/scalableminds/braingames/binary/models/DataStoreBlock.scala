/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import com.scalableminds.util.geometry.Point3D

trait DataAccessInstruction {
  def dataSource: DataSource

  def dataLayer: DataLayer

  def dataLayerSection: DataLayerSection
}

case class CubeReadInstruction(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataLayerSection: DataLayerSection,
  position: CubePosition,
  settings: DataRequestSettings) extends DataAccessInstruction

case class BucketReadInstruction(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataLayerSection: DataLayerSection,
  position: BucketPosition,
  settings: DataRequestSettings) extends DataAccessInstruction {

  def toCubeReadInstruction(cubeLength: Int) =
    CubeReadInstruction(dataSource, dataLayer, dataLayerSection, position.toCube(cubeLength), settings)
}

case class BucketWriteInstruction(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataLayerSection: DataLayerSection,
  position: BucketPosition,
  data: Array[Byte]) extends DataAccessInstruction