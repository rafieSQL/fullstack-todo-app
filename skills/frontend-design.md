# Frontend Design & UI Consistency Skill

## 1. Core Visual Identity (Dark Theme)
- **Background Utama**: `#0b0e14` (Deep Canvas)
- **Surface / Card / Modal**: `#111418` hingga `#181c22`
- **Border / Divider**: `#2a2f38` (1px solid, clean separation)
- **Accent Primary**: `#3b82f6` (Blue) / Neon Green accents
- **Text Hierarchy**:
  - Primary text: `#ffffff`
  - Secondary / Muted: `#94a3b8` / `#64748b`

## 2. Component Design Rules
- **Modals & Overlays**:
  - Wajib berbentuk centered floating modal (`position: fixed; inset: 0;`).
  - Gunakan dimmed backdrop blur (`background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); z-index: 9999;`).
  - DILARANG merender form popup di dalam layout dokumen biasa (*in-flow*) yang bisa menggeser elemen kalender atau list.
- **Buttons**:
  - Primary button: background solid putih `#ffffff`, text `#000000`, font-weight `600`, radius `6px` / `8px`.
  - Secondary / Ghost button: background transparent, border `1px solid #2a2f38`, text `#ffffff`.
  - Hover states wajib memiliki transition smooth (`transition: all 0.2s ease`).
- **Inputs & Dropdowns**:
  - Background `#181c22`, border `#2a2f38`, text `#ffffff`, radius `6px`.
  - Focus state: border-color `#3b82f6` with subtle glow.

## 3. Layout & Responsiveness
- Grid kalender dan dashboard wajib memanfaatkan lebar penuh (*full-width* container).
- Pertahankan vertical & horizontal spacing konsisten (menggunakan padding/gap 8px, 12px, 16px, 24px).
- Jangan membuat scrollbar horizontal ganda (*no unexpected overflow-x*).

## 4. Execution Policy
- Setiap penambahan UI baru (modal, form, chip, card) WAJIB merujuk pada token warna dan bentuk di skill ini.
- Dilarang meng-inject banner atau floating placeholder dengan styling acak (misal ungu/pink) di luar tema resmi.
