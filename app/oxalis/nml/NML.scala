package oxalis.nml

import com.scalableminds.util.geometry.{Point3D, Scale, Vector3D}

case class NML(
  name: String,
  dataSetName: String,
  trees: List[Tree],
  volumes: List[Volume],
  timestamp: Long,
  activeNodeId: Option[Int],
  scale: Scale,
  editPosition: Option[Point3D],
  editRotation: Option[Vector3D],
  zoomLevel: Option[Double]
)
