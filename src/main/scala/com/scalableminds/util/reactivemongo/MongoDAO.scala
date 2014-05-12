/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

trait UnsecuredMongoDAO[T] extends SecuredMongoDAO[T] with GlobalDBAccess

trait SecuredMongoDAO[T] extends SecuredCollection[T] with CollectionHelpers[T] {
  val AccessDefinitions = new DefaultAccessDefinitions {}
}
