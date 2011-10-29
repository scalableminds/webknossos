/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @class This parser parses PLY filetypes.
  
  Here is an example of .ply file:

<pre>
ply
format ascii 1.0
comment VCGLIB generated
element vertex 93837
property float x
property float y
property float z
property float nx
property float ny
property float nz
property int flags
property uchar red
property uchar green
property uchar blue
property uchar alpha
element face 0
property list uchar int vertex_indices
property int flags
end_header
16.0272 47.3837 -49.3279 -2.65358e-07 9.5625e-16 1.01371 16 108 46 58 255 
15.1541 46.7882 -49.3109 -2.65358e-07 9.5625e-16 1.01371 16 48 44 49 255
....
</pre>

  @version:  0.1
  @author:   Andor Salga asalga.wordpress.com
  
  Date:     June 2011
*/
var PLYParser = (function() {

  /**
    @private
  */
  function PLYParser(config) {
    
    var undef;
    
    // defined once to reduce number of empty functions
    var __empty_func = function(){};
  
    var start = config.start || __empty_func;
    var parse = config.parse || __empty_func;
    var end = config.end || __empty_func;
    
    var VERSION = "0.1";
    var XHR_DONE = 4;
    
    var pathToFile = null;
    var fileSizeInBytes = 0;
    
    //
    var numParsedPoints = 0;
    var numTotalPoints = 0;
    var progress = 0;

    var normalsPresent = false;
    var colorsPresent = false;
    
    var gotHeader = false;
        
    // This will hold labels and indices
    // such as:
    // map = {
    // "x":0 , "y":1, etc...
    // }
    var map = {};
    var numValuesPerLine;
        
    // keep track if onprogress event handler was called to 
    // handle Chrome/WebKit vs. Minefield differences.
    //
    // Minefield will call onprogress zero or many times
    // Chrome/WebKit will call onprogress one or many times
    var onProgressCalled = false;
    var AJAX = null;
    
    /**
      Returns the version of this parser.
      @name PLYParser#version
      @returns {String} parser version.
    */
    this.__defineGetter__("version", function(){
      return VERSION;
    });
    
    /**
      Get the number of parsed points so far.
      @name PLYParser#numParsedPoints
      @returns {Number} number of points parsed.
    */
    this.__defineGetter__("numParsedPoints", function(){
      return numParsedPoints;
    });
    
    /**
      Get the total number of points in the point cloud.
      @name PLYParser#numTotalPoints
      @returns {Number} number of points in the point cloud.
    */
    this.__defineGetter__("numTotalPoints", function(){
      return numTotalPoints;
    });
    
    /**
      Returns the progress of downloading the point cloud between zero and one or
      -1 if the progress is unknown.
      @name PLYParser#progress
      @returns {Number|-1}
    */
    this.__defineGetter__("progress", function(){
      return progress;
    });
    
    /**
      Returns the file size of the resource in bytes.
      @name PLYParser#fileSize
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
      
      // Put a reference to the parser in the AJAX object
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

        // If the onprogress event didn't get called--we simply got
        // the file in one go, we can parse from start to finish.
        if(onProgressCalled === false){
          chunk = data;
        }
        // Otherwise the onprogress event was called at least once,
        // that means we need to get the data from a specific point to the end.
        else if(data.length - AJAX.lastNewLineIndex > 1){
          chunk = data.substring(AJAX.lastNewLineIndex, data.length);
        }

        // If the last chunk doesn't have any digits (just spaces)
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
      AJAX.parseChunk = function(chunk){
        
        // this occurs over network connections, but not locally.
        if(chunk !== ""){
        
          if(!gotHeader){
            var header = "" + chunk.match(/(\s|\S)+?end_header/);
            var properties = header.match(/property.*/g);
            
            if(properties){
              for(var prop = 0; prop < properties.length; prop++){
                var t = properties[prop].replace(/property.*\s+/, '');
                map[t] = prop;
              }

              if(map["nx"] && map["ny"] && map["nz"]){
                normalsPresent = true;
              }
              
              if(map["red"] && map["green"] && map["blue"]){
                colorsPresent = true;
              }

              chunk = chunk.replace(/(\s|\S)+?end_header/, '');
            }
            gotHeader = true;
          }
          
          // Don't bother trying to parse if we don't know the format
          // of the data.
          if(gotHeader){
            // Trim trailing spaces.
            chunk = chunk.replace(/\s*$/,"");
            
            // Trim leading spaces.
            chunk = chunk.replace(/^\s+/,"");
            
            // Find out how many numbers there are on one line
            if(!numValuesPerLine){
              var sampleLine = "" + chunk.match(/^.*/);
              sampleLine = sampleLine.replace(/\s*$/,'');
            
              numValuesPerLine = sampleLine.split(/\s+/).length;
            }
            
            // Split on white space.
            chunk = chunk.split(/\s+/);
            
            var numVerts = chunk.length/numValuesPerLine;
            numParsedPoints += numVerts;
            
            var verts = new Float32Array(numVerts * 3);
            var cols;
            var norms;
            
            if(colorsPresent){
              cols =  new Float32Array(numVerts * 3);
            }
            
            if(normalsPresent){
              norms = new Float32Array(numVerts * 3);
            }

            //
            for(var i = 0, j = 0; i < chunk.length; i += numValuesPerLine, j += 3){

              verts[j]   = parseFloat(chunk[ i + map["x"] ]);
              verts[j+1] = parseFloat(chunk[ i + map["y"] ]);
              verts[j+2] = parseFloat(chunk[ i + map["z"] ]);
              
              if(norms){
                norms[j] =   parseFloat(chunk[ i + map["nx"] ]);
                norms[j+1] = parseFloat(chunk[ i + map["ny"] ]);
                norms[j+2] = parseFloat(chunk[ i + map["nz"] ]);
              }
              
             if(cols){
                cols[j]   = parseInt(chunk[ i + map["red"] ], 10)/255;
                cols[j+1] = parseInt(chunk[ i + map["green"] ], 10)/255;
                cols[j+2] = parseInt(chunk[ i + map["blue"] ], 10)/255;
              }
            }
            
            // XB PointStream expects an object with named/value pairs
            // which contain the attribute arrays. These must match attribute
            // names found in the shader
            var attributes = {};
            if(verts){attributes["ps_Vertex"] = verts;}
            if(cols){attributes["ps_Color"] = cols;}
            if(norms){attributes["ps_Normal"] = norms;}
            parse(AJAX.parser, attributes);
          }
        }
      };
    
      /**
        @private
        
        On Minefield, this will occur zero or many times
        On Chrome/WebKit this will occur one or many times
      */
      AJAX.onprogress = function(evt){
        var chunk;
       
        if(evt.lengthComputable){
          fileSizeInBytes = evt.total;
          progress = evt.loaded/evt.total;
        }

        onProgressCalled = true;
        
        // if we have something to actually parse
        if(AJAX.responseText){
          var data = AJAX.responseText;
          
          // we likely stopped getting data somewhere in the middle of 
          // a line in the file
          
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
  return PLYParser;
}());
