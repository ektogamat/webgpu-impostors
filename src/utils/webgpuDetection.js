/**
 * WebGPU detection and feature support utilities.
 * Comments in English per project guidelines.
 */

/**
 * Checks if WebGPU is available in the current browser.
 * @returns {Promise<boolean>} True if WebGPU is supported
 */
export async function detectWebGPUSupport() {
  // Check if GPU API exists
  if (!navigator.gpu) {
    console.log("❌ WebGPU not available: navigator.gpu is undefined");
    return false;
  }

  try {
    // Try to request an adapter
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      console.log("❌ WebGPU not available: No adapter found");
      return false;
    }

    console.log("✅ WebGPU is available!");
    console.log("GPU Adapter:", adapter);

    return true;
  } catch (error) {
    console.log("❌ WebGPU not available:", error.message);
    return false;
  }
}

/**
 * Checks if WebGPU compute shaders are supported.
 * @returns {Promise<boolean>} True if compute shaders are supported
 */
export async function detectComputeShaderSupport() {
  const hasWebGPU = await detectWebGPUSupport();
  if (!hasWebGPU) {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;

    // Check for compute shader limits
    const limits = adapter.limits;

    const hasComputeSupport =
      limits.maxComputeWorkgroupSizeX > 0 &&
      limits.maxComputeWorkgroupSizeY > 0 &&
      limits.maxComputeInvocationsPerWorkgroup > 0;

    if (hasComputeSupport) {
      console.log("✅ WebGPU Compute Shaders are supported!");
      console.log("Compute Limits:", {
        maxWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
        maxWorkgroupSizeY: limits.maxComputeWorkgroupSizeY,
        maxInvocationsPerWorkgroup:
          limits.maxComputeInvocationsPerWorkgroup,
      });
    } else {
      console.log("❌ WebGPU Compute Shaders not supported");
    }

    return hasComputeSupport;
  } catch (error) {
    console.log("❌ Error checking compute shader support:", error.message);
    return false;
  }
}

/**
 * Gets WebGPU adapter information for debugging.
 * @returns {Promise<Object|null>} Adapter info or null if not available
 */
export async function getWebGPUAdapterInfo() {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return null;

    const info = await adapter.requestAdapterInfo();
    const limits = adapter.limits;
    const features = Array.from(adapter.features);

    return {
      vendor: info.vendor || "Unknown",
      architecture: info.architecture || "Unknown",
      device: info.device || "Unknown",
      description: info.description || "Unknown",
      limits: {
        maxTextureDimension2D: limits.maxTextureDimension2D,
        maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
        maxComputeWorkgroupSizeY: limits.maxComputeWorkgroupSizeY,
        maxComputeInvocationsPerWorkgroup:
          limits.maxComputeInvocationsPerWorkgroup,
        maxStorageTexturesPerShaderStage:
          limits.maxStorageTexturesPerShaderStage,
      },
      features,
    };
  } catch (error) {
    console.error("Error getting WebGPU adapter info:", error);
    return null;
  }
}

/**
 * Determines the best atlas generation method based on device capabilities.
 * @param {number} atlasSize - Desired atlas size
 * @returns {Promise<string>} 'compute' or 'webgl'
 */
export async function determineBestAtlasMethod(atlasSize = 2048) {
  const hasCompute = await detectComputeShaderSupport();

  if (!hasCompute) {
    console.log("📊 Using WebGL atlas generation (WebGPU not available)");
    return "webgl";
  }

  // For large atlases, compute is significantly better
  if (atlasSize >= 4096) {
    console.log(
      "📊 Using WebGPU Compute atlas generation (large atlas, 2x faster)"
    );
    return "compute";
  }

  // For small atlases, compute is still faster but less dramatic
  console.log(
    "📊 Using WebGPU Compute atlas generation (1.5-2x faster than WebGL)"
  );
  return "compute";
}

/**
 * Logs detailed WebGPU capabilities to console (for debugging).
 */
export async function logWebGPUCapabilities() {
  console.log("🔍 Checking WebGPU Capabilities...");
  console.log("════════════════════════════════════");

  const hasWebGPU = await detectWebGPUSupport();
  console.log(`WebGPU Available: ${hasWebGPU ? "✅ Yes" : "❌ No"}`);

  if (!hasWebGPU) {
    console.log("════════════════════════════════════");
    return;
  }

  const hasCompute = await detectComputeShaderSupport();
  console.log(`Compute Shaders: ${hasCompute ? "✅ Yes" : "❌ No"}`);

  const info = await getWebGPUAdapterInfo();
  if (info) {
    console.log("\n📱 GPU Information:");
    console.log(`  Vendor: ${info.vendor}`);
    console.log(`  Device: ${info.device}`);
    console.log(`  Architecture: ${info.architecture}`);

    console.log("\n⚡ Compute Limits:");
    console.log(
      `  Max Workgroup Size X: ${info.limits.maxComputeWorkgroupSizeX}`
    );
    console.log(
      `  Max Workgroup Size Y: ${info.limits.maxComputeWorkgroupSizeY}`
    );
    console.log(
      `  Max Invocations: ${info.limits.maxComputeInvocationsPerWorkgroup}`
    );

    console.log("\n🖼️ Texture Limits:");
    console.log(
      `  Max 2D Texture Size: ${info.limits.maxTextureDimension2D}`
    );
    console.log(
      `  Max Storage Textures: ${info.limits.maxStorageTexturesPerShaderStage}`
    );

    if (info.features.length > 0) {
      console.log("\n🎨 Features:");
      info.features.forEach((feature) => {
        console.log(`  - ${feature}`);
      });
    }
  }

  console.log("════════════════════════════════════");
}

/**
 * Browser detection helpers
 */
export function getBrowserInfo() {
  const ua = navigator.userAgent;

  const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua);
  const isEdge = /Edg/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);

  // Extract version numbers
  let version = "Unknown";
  if (isChrome) {
    const match = ua.match(/Chrome\/(\d+)/);
    version = match ? match[1] : version;
  } else if (isEdge) {
    const match = ua.match(/Edg\/(\d+)/);
    version = match ? match[1] : version;
  } else if (isFirefox) {
    const match = ua.match(/Firefox\/(\d+)/);
    version = match ? match[1] : version;
  } else if (isSafari) {
    const match = ua.match(/Version\/(\d+)/);
    version = match ? match[1] : version;
  }

  return {
    isChrome,
    isEdge,
    isFirefox,
    isSafari,
    version: parseInt(version, 10),
    hasLikelyWebGPUSupport:
      (isChrome && parseInt(version, 10) >= 113) ||
      (isEdge && parseInt(version, 10) >= 113),
  };
}

/**
 * Displays browser compatibility warning if needed.
 */
export function checkBrowserCompatibility() {
  const browser = getBrowserInfo();

  if (!browser.hasLikelyWebGPUSupport) {
    console.warn("⚠️ WebGPU Compatibility Warning");
    console.warn("════════════════════════════════════");

    if (browser.isChrome && browser.version < 113) {
      console.warn(`Chrome ${browser.version} detected.`);
      console.warn("WebGPU requires Chrome 113 or later.");
      console.warn("Please update your browser for best performance.");
    } else if (browser.isEdge && browser.version < 113) {
      console.warn(`Edge ${browser.version} detected.`);
      console.warn("WebGPU requires Edge 113 or later.");
      console.warn("Please update your browser for best performance.");
    } else if (browser.isFirefox) {
      console.warn("Firefox detected.");
      console.warn(
        "WebGPU support in Firefox is experimental (version 130+)."
      );
      console.warn('Enable via about:config flag "dom.webgpu.enabled".');
    } else if (browser.isSafari) {
      console.warn("Safari detected.");
      console.warn("WebGPU support in Safari is experimental (version 18+).");
      console.warn('Enable via Develop menu > Experimental Features > "WebGPU".');
    } else {
      console.warn("Unknown or unsupported browser.");
      console.warn("WebGPU is best supported in Chrome 113+ or Edge 113+.");
    }

    console.warn("════════════════════════════════════");
    console.warn("Falling back to WebGL atlas generation.");
  }
}

