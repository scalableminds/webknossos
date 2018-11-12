package controllers

import com.mohiva.play.silhouette.api.Silhouette
import javax.inject.Inject
import oxalis.security.WkEnv
import utils.WkConf

class LegacyApiController @Inject()(conf: WkConf, sil: Silhouette[WkEnv]) extends Controller {}
