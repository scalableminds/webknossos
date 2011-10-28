/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @class This parser parses .PTS filetypes. These files are ASCII
  files used in 3D Studio Max.
  
  @version:  0.1
  @author:   Andor Salga asalga.wordpress.com
  
  Date:     March 2011
*/
var PTSParser = (function() {

  /**
    @private
  */
  function PTSParser(config) {
    
    var undef;
    
    // defined once to reduce number of empty functions
    var __empty_func = function(){};
  
    var start = config.start || __empty_func;
    var parse = config.parse || __empty_func;
    var end = config.end || __empty_func;
    
    const VERSION = "0.1";
    const XHR_DONE = 4;
    
    var pathToFile = null;
    var fileSizeInBytes = 0;
    
    //
    var numParsedPoints = 0;
    var numTotalPoints = 0;
    var progress = 0;
        
    // keep track if onprogress event handler was called to 
    // handle Chrome/WebKit vs. Minefield differences.
    //
    // Minefield will call onprogress zero or many times
    // Chrome/WebKit will call onprogress one or many times
    var onProgressCalled = false;
    var AJAX = null;
    
    /**
      Returns the version of this parser.
      @name PTSParser#version
      @returns {String} parser version.
    */
    this.__defineGetter__("version", function(){
      return VERSION;
    });
    
    /**
      Get the number of parsed points so far.
      @name PTSParser#numParsedPoints
      @returns {Number} number of points parsed.
    */
    this.__defineGetter__("numParsedPoints", function(){
      return numParsedPoints;
    });
    
    /**
      Get the total number of points in the point cloud.
      @name PTSParser#numTotalPoints
      @returns {Number} number of points in the point cloud.
    */
    this.__defineGetter__("numTotalPoints", function(){
      return numTotalPoints;
    });
    
    /**
      Returns the progress of downloading the point cloud between zero and one or
      -1 if the progress is unknown.
      @name PTSParser#progress
      @returns {Number|-1}
    */
    this.__defineGetter__("progress", function(){
      return progress;
    });
    
    /**
      Returns the file size of the resource in bytes.
      @name PTSParser#fileSize
      @returns {Number} size of resource in bytes.
    */
    this.__defineGetter__("fileSize", function(){
      return fileSizeInBytes;
    });
    
    /**
      Stop downloading and parsing the associated point cloud.
    */
    this.stop = function(){
      if(AJAX){
        AJAX.abort();
      }
    };
    
    /**
      @param {String} path Path to the resource.
    */
    this.load = function(path){
      pathToFile = path;

      AJAX = new XMLHttpRequest();
      
      // put a reference to the parser in the AJAX object
      // so we can give the library a reference to the
      // parser within the AJAX event handler scope.
      AJAX.parser = this;

      /**
        @private
        
        Occurs exactly once when the resource begins to be downloaded
      */
      AJAX.onloadstart = function(evt){
        start(AJAX.parser);
      };
            
      /**
        @private
        
        Occurs exactly once, when the file is done being downloaded
      */
      AJAX.onload = function(evt){
      
        var data = AJAX.responseText;
        var chunk = null;

        // if the onprogress event didn't get called--we simply got
        // the file in one go, we can parse from start to finish.
        if(onProgressCalled === false){
          chunk = data;
        }
        // otherwise the onprogress event was called at least once,
        // that means we need to get the data from a specific point to the end.
        else if(data.length - AJAX.lastNewLineIndex > 1){
          chunk = data.substring(AJAX.lastNewLineIndex, data.length);
        }

        // if the last chunk doesn't have any digits (just spaces)
        // don't parse it.
        if(chunk && chunk.match(/[0-9]/)){
          AJAX.parseChunk(chunk);
        }

        numTotalPoints = numParsedPoints;
        
        // Indicate parsing is done. ranges from 0 to 1
        progress = 1;
        
        end(AJAX.parser);
      };
      
      /**
        @private
      */
      AJAX.parseChunk = function(chunkData){
        var chunk = chunkData;
        
        // this occurs over network connections, but not locally.
        if(chunk !== ""){
          
          numPoints = chunk.match(/^[0-9]+\n/);
          numTotalPoints += parseInt(numPoints, 10);

          // get rid of the point count to simplify the rest of the parsing
          chunk = chunk.replace(/^[0-9]+\n/, "");

          // trim trailing spaces
          chunk = chunk.replace(/\s+$/,"");
          
          // trim leading spaces
          chunk = chunk.replace(/^\s+/,"");
          
          // split on white space
          chunk = chunk.split(/\s+/);

          const numValuesPerLine = 7;
          var numVerts = chunk.length/numValuesPerLine;
          numParsedPoints += numVerts;
          
          //invalid arguments
          var verts = new Float32Array(numVerts * 3);
          var cols =  new Float32Array(numVerts * 3);

          // x y z  intensity r g b
          for(var i = 0, j = 0; i < chunk.length; i += numValuesPerLine, j += 3){
            verts[j]   = parseFloat(chunk[i]);
            verts[j+1] = parseFloat(chunk[i+1]);
            verts[j+2] = parseFloat(chunk[i+2]);

            cols[j]   = parseInt(chunk[i+4], 10)/255;
            cols[j+1] = parseInt(chunk[i+5], 10)/255;
            cols[j+2] = parseInt(chunk[i+6], 10)/255;
          }
                    
          // XB PointStream expects an object with named/value pairs
          // which contain the attribute arrays. These must match attribute
          // names found in the shader
          var attributes = {};
          if(verts){attributes["ps_Vertex"] = verts;}
          if(cols){attributes["ps_Color"] = cols;}
          
          parse(AJAX.parser, attributes);
        }
      };
    
      /**
        @private
        
        On Minefield, this will occur zero or many times
        On Chrome/WebKit this will occur one or many times
      */
      AJAX.onprogress = function(evt){
      
       if(evt.lengthComputable){
          fileSizeInBytes = evt.total;
          progress = evt.loaded/evt.total;
        }

        onProgressCalled = true;

        // if we have something to actually parse
        if(AJAX.responseText){
          var chunk;
          var data = AJAX.responseText;
          
          // we likely stopped getting data somewhere in the middle of 
          // a line in the PTS file
          
          // 5.813 2.352 6.500 255 255 255 \n
          // 1.079 1.296 9.360 128 0 0 \n
          // 3.163 2.225 6.1<-- stopped here
          
          // So find the last known newline. Everything from the last
          // request to this last newline can be placed in a buffer.
          var lastNewLineIndex = data.lastIndexOf("\n");
          AJAX.lastNewLineIndex = lastNewLineIndex;
          
          // if the status just changed and we finished downloading the
          // file, grab everyting until the end. If there is only a bunch
          // of whitespace, make a note of that and don't bother parsing.
          if(AJAX.readyState === XHR_DONE){
            chunk = data.substring(AJAX.startOfNextChunk, data.length);
            // If the last chunk doesn't have any digits (just spaces)
            // don't parse it.
            if(chunk.match(/[0-9]/)){
              AJAX.parseChunk(chunk);
            }
          }
          // if we still have more data to go
          else{
            // Start of the next chunk starts after the newline.
            chunk = data.substring(AJAX.startOfNextChunk, lastNewLineIndex + 1);
            AJAX.startOfNextChunk = lastNewLineIndex + 1;
            AJAX.parseChunk(chunk);
          }
        }
      };// onprogress
      
      // open an asynchronous request to the path
      if(AJAX.overrideMimeType){
        // Firefox generates a misleading error if we don't have this line
        AJAX.overrideMimeType("application/json");
      }
      AJAX.open("GET", path, true);
      AJAX.send(null);
    };// load
  }// ctor
  return PTSParser;
}());
