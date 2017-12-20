/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import play.api.libs.json.OFormat

trait WithJsonFormatter[T]{
  protected implicit def formatter: OFormat[T]
}