# Safe Refactoring & State Management Skill

## 1. Single Source of Truth (SSOT) Architecture
- **Root-Level Task Authority**: Seluruh data task/to-do bersumber murni dari Supabase dan dikelola oleh Global Context / Root State (`App.jsx` atau `TaskContext`).
- **Stateless Child Views**:
  - Komponen seperti `ChronosCalendar.jsx`, `FocusMode.jsx`, dan `TaskList.jsx` HANYA bertindak sebagai *presentational components*.
  - DILARANG membuat internal `useState` untuk menyimpan salinan task array, duplicate arrays, atau `localStorage` sync terpisah di komponen anak.
  - Perubahan data (tambah, edit, centang selesai, hapus) WAJIB mengalir melalui handler global agar tersinkronisasi instan (*reactive zero-lag*) di seluruh tab tampilan.

## 2. Safe Refactoring & Atomic Modification Protocol
- **Targeted Edits Only**:
  - Dilarang menulis ulang file berukuran besar secara penuh saat diminta mengedit 1 fitur atau memperbaiki 1 bug.
  - Modifikasi hanya baris, fungsi, atau JSX spesifik yang relevan.
- **Protected Core Modules**:
  - Logika esensial Voice Partner (perekaman audio, MediaRecorder, stream handler, Whisper API, dan Groq voice logic) adalah modul terlindungi. Dilarang mengubah alurnya kecuali ada perintah eksplisit.
- **Dead Code Eradication**:
  - Setiap kali mengganti fungsi atau menghapus elemen UI, bersihkan semua sisa import, state yang tidak terpakai, dan CSS class terkait. Jangan pernah meninggalkan *commented-out JSX* atau variabel hantu.

## 3. Database & Supabase Mutation Hygiene
- **Optimistic Updates**: Saat melakukan mutasi (tambah/hapus task), perbarui UI secara instan sembari menunggu response database Supabase untuk memastikan UX tetap mulus tanpa reload.
- **Error Rollback**: Jika request ke Supabase gagal, rollback state lokal dan tampilkan notifikasi toast informatif ke user.
- **Clean Timestamps**: Simpan `due_date` / `dueDate` selalu dalam format standar ISO lokal browser untuk mencegah bug penumpukan jadwal di baris jam 00:00 kalender.

## 4. Pre-Completion Verification Check
- Sebelum menandai task selesai:
  1. Jalankan `npm run lint` untuk memastikan 0 error / warning.
  2. Jalankan `npm run build` di folder `client` untuk memvalidasi tidak ada circular dependency atau broken JSX.
