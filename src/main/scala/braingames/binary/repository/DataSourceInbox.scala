/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import braingames.binary.models._
import braingames.util.{FoxImplicits, Fox}
import net.liftweb.common._
import braingames.binary.models.UnusableDataSource
import akka.actor.ActorSystem
import play.api.libs.concurrent.Execution.Implicits._

object DataSourceInbox{
  def create(repo: DataSourceRepository, s: ActorSystem) = new DataSourceInbox {
    val dataSourceInboxHelper = new DataSourceInboxHelper {
      val system = s
    }

    val dataSourceRepository = repo
  }
}

trait DataSourceInbox extends FoxImplicits{

  def dataSourceInboxHelper: DataSourceInboxHelper

  def dataSourceRepository: DataSourceRepository

  def importDataSource(id: String): Fox[UsableDataSource] = {
    dataSourceRepository.findInboxSource(id).flatMap {
      case ibx: UnusableDataSource if !dataSourceInboxHelper.isImportInProgress(ibx.id)=>
        dataSourceInboxHelper.transformToDataSource(ibx)
      case d: DataSource =>
        Empty  // TODO: think about what we should do if an already imported DS gets imported again
      case d =>
        Empty
    }
  }

  def handler = new DataSourceInboxChangeHandler(dataSourceRepository)

  def progressForImport(id: String) = dataSourceInboxHelper.progressForImport(id)
}