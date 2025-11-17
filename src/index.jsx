import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.jsx";
import { Leva } from "leva";

createRoot(document.getElementById("root")).render(
  <>
    <App />
    <Leva
      collapsed
      titleBar={{
        drag: false,
        title: "Impostors",
        position: { x: -140, y: 4 },
      }}
    />
  </>
);
