package com.scalableminds.datastore.controllers

import java.nio.file.Paths
import javax.inject.Inject

import com.scalableminds.braingames.binary.store.AnnotationStore
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.util.io.PathUtils
import play.api.Play
import play.api.i18n.MessagesApi
import play.api.mvc.Action

class AnnotationStoreController @Inject()(val messagesApi: MessagesApi) extends Controller {

  lazy val config = Play.current.configuration.underlying

  def backupVolumeTracings = Action { implicit request =>
    val path = Paths.get(config.getString("braingames.binary.annotation.volumes.backupFolder"))
    PathUtils.ensureDirectory(path)
    DataStorePlugin.annotationStore.volumeStore.backup(path)
    Ok
  }
}
