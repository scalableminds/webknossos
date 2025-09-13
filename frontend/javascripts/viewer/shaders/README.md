# Per-Layer Shader Architecture

This document describes the new per-layer shader architecture implemented in WebKnossos.

## Overview

The shader system has been refactored to use a "one shader per data layer" approach, where each data layer gets its own specialized shader function. This improves modularity and maintainability while preserving all existing functionality.

## Architecture

### Core Files

- **`main_data_shaders.glsl.ts`**: Main shader generator that orchestrates individual layer shaders
- **`layer_shaders.ts`**: Contains individual shader classes for different layer types

### Layer Shader Classes

#### `ColorLayerShader`
Handles rendering for color data layers. Features:
- Individual color processing per layer
- Element class-specific processing (int32, uint32, float, etc.)
- Transform and TPS (Thin Plate Spline) support
- Gamma correction and color inversion
- Blending mode support (additive/cover)

#### `SegmentationLayerShader`
Handles rendering for segmentation layers. Features:
- Segment ID extraction and processing
- Hover and active cell highlighting
- Brush overlay rendering
- Support for mapped and unmapped segment IDs

### Generated Shader Functions

Each layer generates its own GLSL function:

**Color layers**: `processLayer_{layerName}(vec3 worldCoordUVW, vec4 currentColor) -> vec4`
**Segmentation layers**: `processSegmentationLayer_{layerName}(vec3 worldCoordUVW, vec4 currentColor) -> vec4`

## Benefits

1. **Modularity**: Each layer type has its own specialized logic
2. **Maintainability**: Changes to one layer type don't affect others
3. **Readability**: Shader code is better organized and easier to understand
4. **Extensibility**: New layer types can be added by creating new shader classes
5. **Performance**: No changes to runtime performance characteristics

## Usage Example

```typescript
// The main shader automatically generates functions for each layer
// and calls them in the proper order:

void main() {
  vec3 worldCoordUVW = getWorldCoordUVW();
  vec4 data_color = vec4(0.0);

  // Process color layers
  data_color = processLayer_layer_abc123(worldCoordUVW, data_color);
  data_color = processLayer_layer_def456(worldCoordUVW, data_color);

  gl_FragColor = data_color;

  // Process segmentation layers
  gl_FragColor = processSegmentationLayer_layer_seg789(worldCoordUVW, gl_FragColor);
}
```

## Migration from Previous Architecture

The new architecture maintains complete backward compatibility:
- All existing uniforms are preserved
- All shader functionality is preserved
- Performance characteristics remain unchanged
- No changes to the public API

## Implementation Details

### Layer Parameter Generation

Each layer gets a `LayerShaderParams` object containing:
- Layer identification (name, sanitized name)
- Element class information (data type, packing, signedness)
- Transform information (affine transforms, TPS transforms)
- Rendering configuration (texture count, GLSL prefix)

### Uniform Generation

Each layer generates its own uniforms:
```glsl
uniform highp sampler2D layer_abc123_textures[4];
uniform float layer_abc123_data_texture_width;
uniform float layer_abc123_alpha;
// ... additional layer-specific uniforms
```

### Shader Function Generation

Individual shader functions are generated for each layer, containing:
- Layer-specific coordinate transformations
- Element class-specific data processing
- Blending and overlay logic
- Error handling and boundary checks

This architecture provides a solid foundation for future shader development while maintaining full compatibility with existing code.