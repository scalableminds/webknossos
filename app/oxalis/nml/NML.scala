package oxalis.nml

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.geometry.Scale

case class NML(
  dataSetName: String,
  trees: List[Tree],
  timestamp: Long,
  activeNodeId: Option[Int],
  scale: Scale,
  editPosition: Option[Point3D])
