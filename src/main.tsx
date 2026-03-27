import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { useScheduleStore } from "./store/scheduleStore";

if (import.meta.env.DEV) {
  (
    globalThis as typeof globalThis & {
      __scheduleStore?: typeof useScheduleStore;
    }
  ).__scheduleStore = useScheduleStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
