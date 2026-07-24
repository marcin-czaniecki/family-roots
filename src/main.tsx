import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import router from "./router.tsx";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Failed to find the root element");
}
const root = createRoot(container);
root.render(<RouterProvider router={router} />);
