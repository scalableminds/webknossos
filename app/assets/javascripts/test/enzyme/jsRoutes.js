// Copied from a server request. Since jsRoutes will go away soon anyway,
// this should be okay as a temporary workaround

const jsRoutes = {};
(function(_root){
var _nS = function(c,f,b){var e=c.split(f||"."),g=b||_root,d,a;for(d=0,a=e.length;d<a;d++){g=g[e[d]]=g[e[d]]||{}}return g}
var _qS = function(items){var qs = ''; for(var i=0;i<items.length;i++) {if(items[i]) qs += (qs ? '&' : '') + items[i]}; return qs ? ('?' + qs) : ''}
var _s = function(p,s){return p+((s===true||(s&&s.secure))?'s':'')+'://'}
var _wA = function(r){return {ajax:function(c){c=c||{};c.url=r.url;c.type=r.method;return jQuery.ajax(c)}, method:r.method,type:r.method,url:r.url,absoluteURL: function(s){return _s('http',s)+'localhost:9000'+r.url},webSocketURL: function(s){return _s('ws',s)+'localhost:9000'+r.url}}}
_nS('controllers.TaskController'); _root.controllers.TaskController.request =
        function() {
          return _wA({method:"GET", url:"/" + "user/tasks/request"})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.annotationsForTask =
        function(id) {
          return _wA({method:"GET", url:"/" + "api/tasks/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/annotations"})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.trace =
        function(typ,id) {
          return _wA({method:"GET", url:"/" + "annotations/" + (function(k,v) {return v})("typ", encodeURIComponent(typ)) + "/" + (function(k,v) {return v})("id", encodeURIComponent(id))})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.finish =
        function(typ,id) {
          return _wA({method:"GET", url:"/" + "annotations/" + (function(k,v) {return v})("typ", encodeURIComponent(typ)) + "/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/finish"})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.finishAll =
        function(typ) {
          return _wA({method:"POST", url:"/" + "annotations/" + (function(k,v) {return v})("typ", encodeURIComponent(typ)) + "/finish"})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.reopen =
        function(typ,id) {
          return _wA({method:"GET", url:"/" + "annotations/" + (function(k,v) {return v})("typ", encodeURIComponent(typ)) + "/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/reopen"})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.editAnnotation =
        function(typ,id) {
          return _wA({method:"POST", url:"/" + "annotations/" + (function(k,v) {return v})("typ", encodeURIComponent(typ)) + "/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/edit"})
        }

_nS('controllers.AnnotationController'); _root.controllers.AnnotationController.createExplorational =
        function() {
          return _wA({method:"POST", url:"/" + "annotations/createExplorational"})
        }

_nS('controllers.AnnotationIOController'); _root.controllers.AnnotationIOController.download =
        function(typ,id) {
          return _wA({method:"GET", url:"/" + "annotations/" + (function(k,v) {return v})("typ", encodeURIComponent(typ)) + "/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/download"})
        }

_nS('controllers.AnnotationIOController'); _root.controllers.AnnotationIOController.taskDownload =
        function(id) {
          return _wA({method:"GET", url:"/" + "api/tasks/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/download"})
        }

_nS('controllers.AnnotationIOController'); _root.controllers.AnnotationIOController.projectDownload =
        function(name) {
          return _wA({method:"GET", url:"/" + "api/projects/" + (function(k,v) {return v})("name", encodeURIComponent(name)) + "/download"})
        }

_nS('controllers.AnnotationIOController'); _root.controllers.AnnotationIOController.userDownload =
        function(id) {
          return _wA({method:"GET", url:"/" + "api/users/" + (function(k,v) {return v})("id", encodeURIComponent(id)) + "/annotations/download"})
        }

_nS('controllers.AnnotationIOController'); _root.controllers.AnnotationIOController.upload =
        function() {
          return _wA({method:"POST", url:"/" + "admin/nml/upload"})
        }

})(jsRoutes);

export default jsRoutes;
