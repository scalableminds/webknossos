package braingames.binary

import braingames.geometry.Point3D
import braingames.binary.models.DataLayerLike
import braingames.binary.models.DataSetLike

case class DataRequest(
  dataSet: DataSetLike,
  layer: DataLayerLike,
  resolution: Int,
  cuboid: Cuboid,
  useHalfByte: Boolean = false,
  skipInterpolation: Boolean)