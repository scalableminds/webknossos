/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.braingames.binary.store.kvstore.KeyValueStore
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.util.tools.FoxImplicits
import net.liftweb.common.{Box, Empty}

class TracingRepository @Inject()(
                                   webKnossosServer: WebKnossosServer
                                   //@Named("braingames-binary") tracingStore: KeyValueStore
                                 ) extends FoxImplicits {

  def find[T](id: String): Box[T] = {
    //tracingStore.get(id).flatMap { value =>
    //  Json.parse(value).validate[T] match {
    //    case t: JsSuccess[T] => Full(t.value)
    //    case JsError(e) => Full()
    //  }
    //}
//    Cache.getOrElse(id, DataLayerExpiration.toSeconds.toInt) {
  //    webKnossosServer.getVolumeTracing(id)
    //}
    Empty
  }
}
