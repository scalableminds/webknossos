package braingames.binary

import braingames.geometry.Point3D
import braingames.binary.models._

case class DataRequest(
  dataSet: DataSet,
  dataLayer: DataLayerId,
  resolution: Int,
  cuboid: Cuboid,
  useHalfByte: Boolean = false,
  skipInterpolation: Boolean)