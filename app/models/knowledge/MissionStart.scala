package models.knowledge

import brainflight.tools.geometry._

case class MissionStart(
    position: Point3D,
    direction: Vector3D,
    startId: Int,
    centerOfMass: Point3D
    )