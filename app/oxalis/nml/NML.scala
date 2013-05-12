package oxalis.nml

import braingames.geometry.Point3D
import braingames.geometry.Scale

case class NML(dataSetName: String, trees: List[Tree], branchPoints: List[BranchPoint], timeStamp: Long, activeNodeId: Int, scale: Scale, editPosition: Point3D, comments: List[Comment])