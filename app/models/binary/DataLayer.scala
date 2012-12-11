package models.binary

sealed abstract class DataLayer {
  val folder: String
  val elementSize: Int
  val supportedResolutions: List[Int]
}

case class ColorLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1)) extends DataLayer{
  val folder = ColorLayer.identifier
}
case class ClassificationLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1), order: List[String]) extends DataLayer {
  val folder = ClassificationLayer.identifier
}
case class SegmentationLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1)) extends DataLayer {
  val folder = SegmentationLayer.identifier
}

object ColorLayer{
  val default = ColorLayer(8, List(1))
  val identifier = "color"
}

object ClassificationLayer{
  val identifier = "classification"
}

object SegmentationLayer{
  val identifier = "segmentation"
}