/**
 * Modular shader utilities for improved maintainability and separation of concerns
 */
export { BaseShader } from "./base_shader";
export { SkeletonShader } from "./skeleton_shader";
export { ShaderUniformUtils } from "./shader_uniform_utils";
export { ShaderOperations } from "./shader_operations";
export { UniformFactory } from "./uniform_factory";

// Re-export the existing shader module system for compatibility
export { default as compileShader } from "./shader_module_system";
export type { ShaderModule } from "./shader_module_system";