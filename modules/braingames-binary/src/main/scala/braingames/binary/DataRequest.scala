package braingames.binary

import braingames.geometry.Point3D
import braingames.binary.models.DataLayer
import braingames.binary.models.DataSet

case class DataRequest(
  dataSet: DataSet,
  layer: DataLayer,
  resolution: Int,
  cuboid: Cuboid,
  useHalfByte: Boolean = false,
  skipInterpolation: Boolean)