# Shader Code Refactoring

This refactoring reorganizes and modularizes the shader code to improve maintainability and separation of concerns without loss of existing features.

## Key Improvements

### 1. Base Shader Classes
- **BaseShader**: Common functionality for all shader materials including material creation, uniform management, and lifecycle handling
- **SkeletonShader**: Specialized base class for skeleton-related shaders (nodes, edges) with shared transform and coordinate handling

### 2. Utility Modules
- **ShaderUniformUtils**: Common utilities for shader uniform management including transform listeners and coordinate handling
- **ShaderOperations**: Shared operations like shader code updating and uniform management
- **UniformFactory**: Factory functions for creating common uniform patterns

### 3. Improved Separation of Concerns
- **Eliminated code duplication** between NodeShader and EdgeShader classes
- **Centralized common patterns** like transform handling, store listeners, and material lifecycle
- **Consistent interfaces** for all shader materials
- **Better error handling** and type safety

## Benefits

1. **Reduced Code Duplication**: ~150+ lines of duplicated code eliminated between NodeShader and EdgeShader
2. **Improved Maintainability**: Common patterns centralized in reusable modules
3. **Better Type Safety**: Consistent interfaces and proper type definitions
4. **Easier Testing**: Modular structure allows for better unit testing
5. **Future Extensibility**: New shader types can easily extend base classes

## Backward Compatibility

All existing APIs are preserved:
- `NodeShader` and `EdgeShader` maintain their public interfaces
- `PlaneMaterialFactory` continues to work with existing patterns
- All existing shader functionality is preserved
- Performance characteristics remain the same

## Usage Examples

### Creating a New Skeleton Shader
```typescript
class MySkeletonShader extends SkeletonShader {
  constructor(treeColorTexture: DataTexture) {
    super("my-shader", treeColorTexture);
  }

  protected setupCustomUniforms(): void {
    // Add shader-specific uniforms
    Object.assign(this.uniforms, {
      customUniform: { value: 1.0 },
    });
  }

  getVertexShader(): string {
    // Return vertex shader code
  }

  getFragmentShader(): string {
    // Return fragment shader code
  }
}
```

### Using Uniform Utilities
```typescript
// Create layer uniforms
const uniforms = UniformFactory.createCompleteLayerUniforms("myLayer", {
  alpha: 0.8,
  color: [255, 128, 0],
  isInverted: false,
});

// Update shader code safely
ShaderOperations.updateShaderCode(
  material,
  newFragmentCode,
  newVertexCode,
  oldFragmentCode,
  oldVertexCode,
  () => console.log("Shader updated"),
);
```

This refactoring maintains all existing functionality while providing a cleaner, more maintainable codebase for future development.