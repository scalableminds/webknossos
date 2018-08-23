package models.annotation

import com.scalableminds.webknossos.datastore.storage.TemporaryStore

object TemporaryAnnotationStore extends TemporaryStore[String, Annotation] {
  val system = akka.actor.ActorSystem("system")
}
