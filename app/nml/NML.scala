package nml

import brainflight.tools.geometry.Point3D
import brainflight.tools.geometry.Scale

case class NML(dataSetName: String, trees: List[Tree], branchPoints: List[BranchPoint], timeStamp: Long, activeNodeId: Int, scale: Scale, editPosition: Point3D, comments: List[Comment])