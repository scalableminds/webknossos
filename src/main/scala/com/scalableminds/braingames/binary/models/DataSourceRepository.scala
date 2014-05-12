package com.scalableminds.braingames.binary.models

import com.scalableminds.util.tools.{FoxImplicits, Fox}
import akka.agent.Agent
import akka.actor.ActorSystem
import play.api.libs.concurrent.Execution.Implicits._

trait DataSourceRepository extends InboxSourceRepository {

  def findUsableDataSource(name: String): Fox[DataSource]

  def updateDataSources(dataSources: List[DataSourceLike])
}

trait InboxSourceRepository {

  def inboxSources: List[DataSourceLike]

  def updateInboxSources(sources: List[DataSourceLike]): Unit

  def findInboxSource(id: String): Fox[DataSourceLike]
}

trait InMemoryInboxSourceRepository extends InboxSourceRepository with FoxImplicits {

  implicit def system: ActorSystem

  lazy val dataSources = Agent[List[DataSourceLike]](Nil)

  def inboxSources: List[DataSourceLike] = dataSources()

  def updateInboxSources(sources: List[DataSourceLike]) = {
    dataSources.send(sources)
  }

  def findInboxSource(id: String): Fox[DataSourceLike] = {
    dataSources().find(_.id == id)
  }
}