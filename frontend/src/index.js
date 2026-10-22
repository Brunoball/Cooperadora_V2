import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./components/Global/Global_css/GlobalSelectSizing.css";
import { enableGlobalSelectSizing } from "./utils/selectSizing";

// Un único observador para los filtros de todas las pantallas y modales.
enableGlobalSelectSizing();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
