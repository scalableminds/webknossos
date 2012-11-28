package brainflight.tools.geometry

case class OrientedPosition(translation: Vector3D, direction: Vector3D)

object OrientedPosition {

  def default = OrientedPosition(Vector3D(0, 0, 0), Vector3D(0, 0, 0))

  /*def fromLine(line: String) = {
    val splitted = line.split(" ").map(_.toFloat)
    if (splitted.size == 6) {
      val translation = Vector3D(splitted(0), splitted(1), splitted(2))
      val direction = Vector3D(splitted(3), splitted(4), splitted(5))
      Some(OrientedPosition(translation, direction))
    } else {
      None
    }
  }*/
}