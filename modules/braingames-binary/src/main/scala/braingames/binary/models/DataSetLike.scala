package braingames.binary.models

trait DataSetLike {

  def baseDir: String

  def name: String
  
  def colorLayer: DataLayerLike
}