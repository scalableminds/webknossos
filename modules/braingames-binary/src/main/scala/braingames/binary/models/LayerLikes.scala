package braingames.binary.models

import play.api.libs.json.Reads

trait ColorLayerLike{

}

trait ColorLayerFactoryLike{
  def createColorLayer(supportedResolutions: List[Int]): ColorLayerLike
}

trait SegmentationLayerLike{
  
}

trait ClassificationLayerLike

trait ContextFreeSegmentationLayerLike{
  def addContext(ctx: Int) : SegmentationLayerLike
}