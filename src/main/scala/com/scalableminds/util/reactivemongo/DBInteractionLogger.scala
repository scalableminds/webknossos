/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import com.scalableminds.util.tools.LazyLogger


trait DBInteractionLogger {

  lazy val logger = LazyLogger("braingames.reactivemongo")
}