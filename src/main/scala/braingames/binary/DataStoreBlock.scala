package braingames.binary

import braingames.binary.models.DataLayer
import braingames.binary.models.DataSet
import braingames.geometry.Point3D
import braingames.binary.models.DataLayerSection

trait DataStoreBlock {
  def dataSet: DataSet
  def dataLayer: DataLayer
  def dataLayerSection: DataLayerSection
  def resolution: Int
  def block: Point3D }


case class LoadBlock(
  dataSet: DataSet,
  dataLayer: DataLayer,
  dataLayerSection: DataLayerSection,
  resolution: Int,
  block: Point3D) extends DataStoreBlock

case class SaveBlock(
  dataSet: DataSet,
  dataLayer: DataLayer,
  dataLayerSection: DataLayerSection,
  resolution: Int,
  block: Point3D,
  data: Array[Byte]) extends DataStoreBlock