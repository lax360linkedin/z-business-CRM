# Personalization

**Settings → Personalization** (`/settings/personalization`, the old *Appearance* page; `/settings/appearance` forwards to it) lets each person choose how the CRM looks. It is open to every signed-in person (it needs no permission) and only changes appearance: it never changes what someone can see or do, their permissions or their branch access.

## What can be chosen
| Section | Options |
| --- | --- |
| Appearance mode | Light, Dark, System (follows the device, live) - each with a preview card |
| Accent colour | 20 palettes (Indigo, Royal Blue, Ocean Blue, Cyan, Teal, Emerald Green, Forest Green, Lime, Amber, Orange, Coral, Red, Rose, Pink, Violet, Purple, Lavender, Slate, Graphite, Monochrome) and a custom HEX colour (picker or typed), "Default colour" |
| Interface style | Classic, Modern (the standard look), Glass, Minimal, High Contrast - each with a preview card; a style also sets the surface options below |
| Contrast & accessibility | Standard, Increased, High, Automatic (follows the device's "more contrast" setting where the browser reports it) |
| Background & surfaces | Page background (solid, subtle gradient, neutral, soft tint), card surface (solid, soft tint, outlined), border strength, shadow strength, corner radius, glass blur (Glass only) |
| Typography & density | Text size (small / medium / large), density (compact / comfortable / spacious), readability (standard / enhanced) |

The page has a live preview, a sticky **Apply Changes / Discard / Reset to Default** bar, and shows every choice across the whole CRM immediately. A choice is only kept when **Apply Changes** is pressed; **Discard** or leaving the page returns to the saved look; **Reset to Default** previews the standard look (apply to keep it). The header's sun/moon button still flips light/dark and saves at once.

## How it works
* **Preferences** (`theme/personalization.js`): one small object (`mode, accent, customAccent, ui, contrast, bg, card, border, shadow, radius, blur, size, density, read`); `sanitize()` turns anything stored or typed into valid values, so a damaged entry cannot break the app. The defaults reproduce the CRM exactly as it looked before.
* **Provider** (`context/ThemeContext.jsx`): keeps the saved (`applied`) and the trial (`draft`) preferences and writes the effective ones onto `<html>`: the `dark` class, `data-ui / contrast / bg / card / border / shadow / radius / blur / size / density / read / accent` attributes and the CSS variables `--brand-50…950`, `--radius-scale`, `--shadow-scale`, `--glass-blur`, `--font-percent`. `useTheme()` keeps its old API (`mode, setMode, theme, toggleTheme, accent, setAccent, accentHex`), so the charts and the login screen are unchanged.
* **Stylesheet**: `tailwind.config.js` (the neutral `ink-*` scale is now `--ink-*` variables; shadows and corner radii scale with `--shadow-scale` / `--radius-scale`), `index.css` (default tokens: Purple and the neutral scale), `theme/personalization.css` (backgrounds, border strength, card surfaces, Glass, contrast levels, focus rings, density, readability, reduced motion). No component hard-codes a colour, and the defaults emit no overrides.
* **Accent palettes**: `buildScale()` creates the 11 shades for light and for dark mode from one colour. Shade 600 (buttons, active menu items) is darkened until white text on it reaches WCAG AA (4.5:1); in dark mode a very dark accent is lifted so it shows on dark panels, and shades 300/400 (links, highlights) are lifted until they reach AA on the dark panel colour. A colour that had to be changed is flagged on the page. Checked for all 20 palettes in both modes (button, active menu item and link text all ≥ 4.5:1).
* **First paint**: a small script in `index.html` applies the saved look before React starts (the accent shades are cached beside the preferences), so there is no flash of the wrong theme.
* **Glass**: translucent surfaces with a blur (`--glass-blur`), only on panels, the sidebar, the top bar, popovers and dialogs. Tables and forms use a nearly opaque surface and no blur, nested panels never blur twice, High contrast is always solid, and browsers without `backdrop-filter` get opaque surfaces. `Modal` and `Drawer` render into `<body>` so a blurred card can never trap them.
* **Contrast**: Increased / High strengthen secondary text, borders and the keyboard focus ring and make disabled controls and status badges obviously different (dashed outline, heavier badge outline). The *High Contrast* interface style always uses the High level; *Automatic* uses Increased when the device asks for more contrast.
* **Motion**: with the system "reduce motion" setting on, transitions and animations are cut to near zero (spinners keep spinning).

## Where it is saved
Visual preferences only, in this browser's `localStorage` under `business_crm_personalization_v1`, **per signed-in person**: each account gets its own saved look, restored when they sign in again; a new person starts from the standard look (the first person to sign in after this feature arrives keeps the mode/accent the browser already had). Nothing sensitive is stored. The CRM has no per-user settings store on the server, so the look is **not** synced between devices or browsers; adding that needs a small backend preference field (not done).

## Adding to it
A new option goes in `theme/personalization.js` (list + default + `sanitize`), `applyToDocument()` (attribute), `theme/personalization.css` (the look), the page `pages/Settings/PersonalizationPanel.jsx`, and the first-paint script in `index.html`.
