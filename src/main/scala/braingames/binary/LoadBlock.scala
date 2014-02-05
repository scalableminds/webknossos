package braingames.binary

import braingames.binary.models.DataLayer
import braingames.binary.models.DataSource
import braingames.geometry.Point3D
import braingames.binary.models.DataLayerSection

case class LoadBlock(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataLayerSection: DataLayerSection,
  resolution: Int,
  block: Point3D) 