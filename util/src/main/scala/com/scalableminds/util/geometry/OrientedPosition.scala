package com.scalableminds.util.geometry

case class OrientedPosition(translation: Vector3D, direction: Vector3D)

object OrientedPosition {

  def default = OrientedPosition(Vector3D(0, 0, 0), Vector3D(0, 0, 0))
}
