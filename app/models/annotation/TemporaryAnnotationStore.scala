/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.webknossos.datastore.storage.TemporaryStore

object TemporaryAnnotationStore extends TemporaryStore[String, AnnotationSQL] {
  val system = akka.actor.ActorSystem("system")
}
