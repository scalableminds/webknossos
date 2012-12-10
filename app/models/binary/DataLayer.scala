package models.binary

sealed abstract class DataLayer {
  val identifier: String
  val folder: String
  val elementSize: Int
}

case class ColorLayer() extends DataLayer{
  val identifier = "color"
  val folder = identifier
  val elementSize = 8
}
case class ClassificationLayer(elementSize: Int, order: List[String]) extends DataLayer {
  val identifier = "classification"
  val folder = identifier
}
case class SegmentationLayer(elementSize: Int) extends DataLayer {
  val identifier = "segmentation"
  val folder = identifier
}

