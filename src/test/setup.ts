import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { useScheduleStore } from "../store/scheduleStore";

beforeEach(() => {
  window.localStorage.clear();
  useScheduleStore.getState().resetForTests(null);
});

afterEach(() => {
  useScheduleStore.getState().resetForTests(null);
});
