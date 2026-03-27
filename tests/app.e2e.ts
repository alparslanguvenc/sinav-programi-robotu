import { expect, test } from "@playwright/test";

test("moving a card updates its slot and raises conflict count", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/52\/52 kart görünür/i)).toBeVisible();
  await expect(page.getByText(/7 aktif uyarı/i)).toBeVisible();

  const targetCell = page.locator(
    '[data-slot-key="Sal 24.03.2026__@@__11:00"]',
  );

  await page.evaluate(() => {
    const store = (
      globalThis as typeof globalThis & {
        __scheduleStore?: {
          getState: () => {
            document: {
              exams: Array<{
                id: string;
                courseName: string;
              }>;
            } | null;
            moveExam: (cardId: string, slotKey: string) => void;
          };
        };
      }
    ).__scheduleStore;

    if (!store) {
      throw new Error("Test store kancası bulunamadı.");
    }

    const state = store.getState();
    const card = state.document?.exams.find(
      (exam) => exam.courseName === "Yönetim ve Organizasyon",
    );

    if (!card) {
      throw new Error("Kart bulunamadı.");
    }

    state.moveExam(card.id, "Sal 24.03.2026__@@__11:00");
  });

  await expect(page.getByText(/8 aktif uyarı/i)).toBeVisible();
  await expect(targetCell.locator('[data-course-name="Yönetim ve Organizasyon"]')).toBeVisible();
});
