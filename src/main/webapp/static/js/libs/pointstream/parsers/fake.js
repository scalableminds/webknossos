/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @class This is a fake parser which instead of parsing a point cloud, will
  return a series of points which can be used in ref tests and shader tests.
  
  This parser is not included in release version of the library. It is only
  available for development versions.
  
  @version:   0.1
  @author:    Andor Salga asalga.wordpress.com
  
  Date:       August 2011
*/
var FAKEParser = (function() {

  /**
    @private
  */
  function FAKEParser(config) {
    var start = config.start || __empty_func;
    var parse = config.parse || __empty_func;
    var end = config.end || __empty_func;
    
    var numParsedPoints = 0;
    var numTotalPoints = 0;
    var progress = 0;

    /*
    */
    function createPlane(verts, cols, norms){

      var x = -0.5, y = -0.5;
      for(var p = 0;p < verts.length; p += 3){
      
        if(p > 0 && p % 300 === 0){
          x = -0.5;
          y += 0.01;
        }
        
        // White for now.
        cols[p] = cols[p+1] = cols[p+2] = 1;
        
        norms[p] = norms[p+1] = 0;
        norms[p+2] = 1;
        
        verts[p    ] = x;
        verts[p + 1] = y;
        verts[p + 2] = 0;

        x += 0.01;  
      }
    }
    
    /*
    */
    function createCylinder(verts, cols, norms){
      var radians = 0;
      
      var y = 0.3;
      for(var p = 0;p < verts.length; p += 3){
        radians += 0.01745 * 2;
        
        // y normal component is always zero.
        norms[p+1] = 0;
        
        norms[p]   = verts[p  ] = Math.sin(radians);
                     verts[p+1] = y;
        norms[p+2] = verts[p+2] = Math.cos(radians);
        
        if(p > 0 && p % (360 * 3) === 0){
          y -= 0.05;
        }
        
        // White for now.
        cols[p] = cols[p+1] = cols[p+2] = 1;
      }
    }
    
    /**
      Returns the version of this parser.
      @name ASCParser#version
      @returns {String} parser version.
    */
    this.__defineGetter__("version", function(){
      return "0.1";
    });
    
    /**
      Get the total number of generated points.
      @name ASCParser#numParsedPoints
      @returns {Number} number of generated points.
    */
    this.__defineGetter__("numParsedPoints", function(){
      return numParsedPoints;
    });
    
    /**
      Get the total number of generated points.
      @name ASCParser#numTotalPoints
      @returns {Number} number of generated points.
    */
    this.__defineGetter__("numTotalPoints", function(){
      return numTotalPoints;
    });
    
    /**
      Returns 1 after onload is finished.
      @name ASCParser#progress
      @returns {Number}
    */
    this.__defineGetter__("progress", function(){
      return progress;
    });
    
    /**
      Returns -1 since there is file associated with this parser.
      @name ASCParser#fileSize
      @returns {Number} -1
    */
    this.__defineGetter__("fileSize", function(){
      return -1;
    });
    
    /**
      Stop downloading and parsing the associated point cloud.
    */
    this.stop = function(){
    };
    
    /**
      @param {"plane.fake"} path Path to the resource.
    */
    this.load = function(path){
     
      start(this);
      
      var attr = {};
      var verts,
          cols,
          norms;
      
      // 100 x 100 point plane
      // from -0.5 to +0.5 on the xy axis
      if(path == "plane.fake"){
        numParsedPoints = numTotalPoints = 10000;
        
        verts = new Float32Array(numTotalPoints * 3);
        cols = new Float32Array(numTotalPoints * 3);
        norms = new Float32Array(numTotalPoints * 3);

        createPlane(verts, cols, norms);
      }
      else if(path === "cylinder.fake"){
        
        numParsedPoints = numTotalPoints = 3600;
        
        verts = new Float32Array(numTotalPoints * 3);
        cols = new Float32Array(numTotalPoints * 3);
        norms = new Float32Array(numTotalPoints * 3);
        
        createCylinder(verts, cols, norms);
      }
      
      if(verts){attr["ps_Vertex"] = verts;}
      if(cols){attr["ps_Color"] = cols;}
      if(norms){attr["ps_Normal"] = norms;}
      
      progress = 1;        
      parse(this, attr);
      end(this);
    };
  }
  return FAKEParser;
}());
