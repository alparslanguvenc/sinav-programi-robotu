import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfilePanel } from "../components/ProfilePanel";
import type { SchoolProfile } from "../types/schedule";

const baseProfile: SchoolProfile = {
  id: "profile-1",
  name: "Test Profili",
  updatedAt: new Date().toISOString(),
  dates: ["Pzt 23.03.2026"],
  times: ["09:00"],
  programs: ["Gazetecilik"],
  classYears: ["1.S"],
  rooms: ["101"],
  instructors: ["Dr. Ayşe Kaya"],
  courseTemplates: [],
};

describe("ProfilePanel", () => {
  it("publishes unsaved draft time changes", async () => {
    const onDraftProfileChange = vi.fn();

    render(
      <ProfilePanel
        activeProfile={baseProfile}
        document={null}
        onSaveProfile={() => ({ ok: true, message: "ok" })}
        onDeleteProfile={() => ({ ok: true, message: "ok" })}
        onLoadDocument={() => {}}
        onStatus={() => {}}
        onDraftProfileChange={onDraftProfileChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Saatler"), {
      target: { value: "10:00\n14:00" },
    });

    await waitFor(() => {
      const lastCall = onDraftProfileChange.mock.calls.at(-1)?.[0] as SchoolProfile | undefined;
      expect(lastCall?.times).toEqual(["10:00", "14:00"]);
    });
  });
});
