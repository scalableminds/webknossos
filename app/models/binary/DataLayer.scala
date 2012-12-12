package models.binary

sealed trait DataLayer {
  val folder: String
  val elementSize: Int
  val supportedResolutions: List[Int]
  def bytesPerElement = elementSize / 8
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
  val default = ClassificationLayer(8, List(1), List("mito"))
  val identifier = "classification"
}

object SegmentationLayer{
  val default = SegmentationLayer(16, List(1))
  val identifier = "segmentation"
}