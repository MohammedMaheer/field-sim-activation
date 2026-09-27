# Shared colour and motion direction

The web experience.css tokens and Flutter RelayPalette define the current client design direction. Burgundy #8B2452 anchors primary actions; plum #7541B0 marks workflow progress; teal #087E6A marks success. Warm amber signals attention, muted blue provides secondary chart contrast, and charcoal is used for reading text. Chart colours follow the same roles on web and mobile.

Use rich burgundy/plum gradients only for primary emphasis. Light rose/plum/teal gradients frame page headers and receipt progress; data tables and inputs retain quiet surfaces. KPI cards use a tinted-to-light gradient for depth. Avoid introducing unrelated saturated colours or changing status meanings for decoration.

Web entrances last 240-380 ms, KPI stagger is 35 ms, hover elevation is limited to clickable cards, and progress changes use a brief ring transition. Flutter keeps its shared page and surface entrance transitions and animates workflow progress colours. Reduced-motion preferences disable decorative movement in both clients. Do not add perpetual decorative animation.

White text contrast at the primary gradient endpoints is 8.50:1 and 9.02:1; workflow endpoints 6.69:1 and 6.62:1. White on teal is 5.00:1. These are scoped token checks, not a claim of a complete accessibility certification.

## Verification and release — 27 September 2026

Web build passed. Four browser checks passed using local built assets against the demo API, covering 15 routes at desktop/phone widths, drawer focus/sorting, back navigation, reduced motion and receipt entry. After publishing, two hosted navigation/receipt checks passed again. Flutter analysis was clean and 9 widget/render checks passed, including all main field screens and detail sheets. Rendered contact sheets were visually inspected; evidence is outside Git in output/qa.

Build 19 was installed and launched on the connected Android phone. Home and receipt routes were inspected, versionCode 19 confirmed, and original automatic rotation restored. APK SHA256: f0fcd744297f38bc038803b727d1a8baeb337f2b1b75ac93f87019a7f7bbdff7. Local and VPS hashes match.

Client-only backup: /opt/relay-client/backups/palette-20260927T083922Z, including database, web assets, build 18 APK and migration state. Migration remains 005 (head), API health passed, and this presentation-only release changes no database or backend behavior. Rollback restores backed-up web assets and previous.apk; database restoration is unnecessary. Existing receipt OCR workflow and its previously tested limitations remain unchanged.
