(function() {

  define(["geometry_factory", "view"], function(GeometryFactory, View) {
    var CubeHelper;
    return CubeHelper = {
      cubeCount: 0,
      rootCube: null,
      XYcanvas: null,
      XZcanvas: null,
      origin: [500, 500, 500],
      canvasSize: 200,
      initialize: function() {
        var _this = this;
        this.XYcanvas = $("<canvas id=\"XYcanvas\" width=" + this.canvasSize + "height=" + this.canvasSize(+"/>")).appendTo("div#main");
        this.XZcanvas = $("<canvas id=\"XZcanvas\" width=" + this.canvasSize + "height=" + this.canvasSize(+"/>")).appendTo("div#main");
        this.XYcanvas = $(this.XYcanvas)[0].getContext("2d");
        this.XZcanvas = $(this.XZcanvas)[0].getContext("2d");
        this.XYcanvas.fillRect(0, 0, 1, this.canvasSize);
        this.XYcanvas.fillText("Y", 0, 100);
        this.XYcanvas.fillRect(0, 0, 100, 1);
        this.XYcanvas.fillText("X", 100, 5);
        return $(window).on("bucketloaded", function(event, vertex) {
          return _this.addCube(vertex);
        });
      },
      addCube: function(position) {
        var x, y, z;
        x = position[0] - this.origin[0];
        y = position[1] - this.origin[1];
        z = position[2] - this.origin[2];
        log(x, y, z);
        this.XYcanvas.fillRect(x, y, 2, 2);
        this.XZcanvas.fillRect(x, z, 2, 2);
        return this.cubeCount++;
      }
    };
  });

}).call(this);
