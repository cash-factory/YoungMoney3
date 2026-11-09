# Website journey, mobile and theme QA

This checklist is for the existing human-designed YoungMoney3 interface; it is **not** a redesign specification. Code-level UI contract tests ensure that all navigation targets, the original landing/auth/setup flow and distinct premium color palettes remain present. They do **not** replace a real browser walkthrough.

## Browser acceptance matrix

For each of Chrome/Edge desktop, mobile Safari/Chrome (or browser automation of those viewports):
1. Fresh visitor: landing page displays, appearance picker changes palette, **Enter** goes to login. Sign-in and invite signup show errors clearly. Return to landing.
2. Signed-in first time: onboarding is optional, not a blocker; dashboard is reachable. Sidebar, command palette, top navigation and back/forward hash navigation work.
3. Two accounts with different currencies: account selector isolates positions, P&L, risk, Insights and broker balances; combined money totals must not silently merge currencies.
4. Trades: manual creation, numeric validation, edit, delete and stale-revision warning. MT5 trades show read-only fill data and editable journal notes only.
5. Account settings: theme, color, profile, password, backup modal, and MT5 pairing. Confirm modal ESC/close and scroll behavior on 320px / 375px / tablet / desktop widths.
6. Walk through **all 11 curated palettes** in both light and dark modes. Confirm readable text, visual distinction, no overlapping menu, no missing button focus, persistence across navigation and browser reload.
7. Force offline API errors, corrupt theme local storage or disable browser storage: the layout must remain navigable and explain failures.
8. Accessibility: semantic labels, aria state, keyboard-only navigation, dialog focus/close, reduced-motion preferences and reasonable contrast. Record screenshots and defects before release.

Record tested commit, staging URL, viewport, platform, palette, test user ID and defect links. Do not claim visual/browser acceptance based on static CI alone.
