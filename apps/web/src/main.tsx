import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { createBrowserAppServices } from "./app/createBrowserAppServices";
import "./css-system.css";

const browserAppServices = createBrowserAppServices();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App services={browserAppServices} />
  </React.StrictMode>
);
