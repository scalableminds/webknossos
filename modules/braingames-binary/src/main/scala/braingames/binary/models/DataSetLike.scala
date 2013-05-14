package braingames.binary.models

import braingames.geometry.Point3D
import braingames.binary.models.defaults.SegmentationLayer
import braingames.binary.models.defaults.ColorLayer
import braingames.binary.models.defaults.ClassificationLayer

trait BareDataSetLike{
  def addLayers(
      baseDir: String, 
      colorLayer: ColorLayerLike, 
      segmentationLayers: List[SegmentationLayerLike], 
      classificationLayer: Option[ClassificationLayerLike]): DataSetLike
}

trait DataSetLike {

  def baseDir: String

  def name: String
  
  def colorLayer: DataLayerLike
}

trait DataSetFactoryLike{
  def createDataSet[A <: ColorLayerLike, B <: DataSetLike](
      name: String,
      path: String,
      maxCoordinates: Point3D,
      colorLayer: A) : B
}