import { Page } from '@playwright/test';

/**
 * Picks an option of an open Ant Design select by its title. The dropdown
 * opens with an animation; a click on an option while the list still grows
 * makes Playwright scroll the virtual list to bring the option into view,
 * the list renders again under the pointer and the click never lands. The
 * animation is waited for first.
 */
export const pickOption = async (page: Page, title: string): Promise<void> => {
  const option = page.locator(`.ant-select-item-option[title="${title}"]`);
  await option.waitFor({ state: 'visible' });
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
    .evaluate((dropdown) =>
      Promise.all(dropdown.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
  await option.click();
};
