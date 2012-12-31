package brainflight.binary

import models.binary.DataLayer
import models.binary.DataSet
import brainflight.tools.geometry.Point3D
import play.api.Play

case class DataRequest(
  dataSet: DataSet,
  layer: DataLayer,
  resolution: Int,
  cuboid: Cuboid,
  useHalfByte: Boolean = false)