package braingames.binary.models

trait DataSetRepository {
  def deleteAllDataSetsExcept(l: Array[String])
  def updateOrCreateDataSet(dataSet: DataSetLike)
  def removeDataSetByName(name: String)
}