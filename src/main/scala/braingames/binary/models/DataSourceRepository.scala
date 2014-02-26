package braingames.binary.models

import braingames.util.Fox

trait DataSourceRepository {
  def findByName(name: String): Fox[DataSource]
  def foundDataSources(dataSources: List[DataSourceLike])
}