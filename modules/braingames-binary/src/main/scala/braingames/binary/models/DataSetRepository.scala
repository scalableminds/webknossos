package braingames.binary.models

trait DataSetRepository {
  def deleteAllDataSetsExcept(l: Array[String])
  def updateOrCreateDataSet(dataSet: DataSet)
  def removeDataSetByName(name: String)
}