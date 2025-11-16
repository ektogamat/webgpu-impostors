import React, { memo } from "react";
import { useControls } from "leva";
import CustomGrid from "./CustomGrid";

/**
 * GridWrapper component that encapsulates CustomGrid with Leva controls
 * This prevents unnecessary re-renders when grid properties change
 */
const GridWrapper = memo(() => {
  // Leva controls for grid configuration
  const { showGrid, gridUnit, gridSize, gridDivisions } = useControls({
    showGrid: { value: true, label: "Show Grid" },
    gridUnit: {
      value: "meters",
      options: ["meters", "feet", "inches", "centimeters"],
      label: "Grid Unit",
    },
    gridSize: { value: 20, min: 1, max: 50, label: "Grid Size" },
    gridDivisions: { value: 40, min: 5, max: 100, label: "Grid Divisions" },
  });

  // Only render grid if showGrid is true
  if (!showGrid) return null;

  return (
    <CustomGrid
      unit={gridUnit}
      size={gridSize}
      divisions={gridDivisions}
      color="#000000"
      opacity={0.5}
      dotRadius={0.05}
      position={[0, -1.2, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    />
  );
});

// Set display name for debugging
GridWrapper.displayName = "GridWrapper";

export default GridWrapper;
