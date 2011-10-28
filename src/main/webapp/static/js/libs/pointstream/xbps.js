/*jsl:import parsers/asc.js*/
/*jsl:import parsers/fake.js*/
/*jsl:import parsers/hps0.js*/
/*jsl:import parsers/ply.js*/
/*jsl:import parsers/psi.js*/
/*jsl:import parsers/psi2.js*/
/*jsl:import parsers/pts.js*/

/*jsl:import libs/mjs.js*/
/*jsl:import libs/c3.js*/

/*jsl:import psapi.js*/

/*

var ps_include = function(path){
  var lastScript = document.getElementsByTagName("head")[0].lastChild;
  var fullUrl = lastScript.src.substring(0, lastScript.src.lastIndexOf('/') + 1) + path;
  document.write('<' + 'script');
  document.write(' language="javascript"');
  document.write(' type="text/javascript"');
  document.write(' src="' + fullUrl + '">');
  document.write('</' + 'script' + '>');
};

ps_include('psapi.js');
ps_include('./libs/mjs.js');
ps_include('./parsers/asc.js');
ps_include('./parsers/psi.js');
ps_include('./parsers/pts.js');
ps_include('./parsers/ply.js');
ps_include('./parsers/hps0.js');
ps_include('./parsers/psi2.js');
*/
Modernizr.load([
  'js/libs/pointstream/psapi.js',
  'js/libs/pointstream/libs/mjs.js',
  'js/libs/pointstream/parsers/asc.js',
  'js/libs/pointstream/parsers/psi.js',
  'js/libs/pointstream/parsers/pts.js',
  'js/libs/pointstream/parsers/ply.js',
  'js/libs/pointstream/parsers/hps0.js',
  'js/libs/pointstream/parsers/psi2.js'
]);