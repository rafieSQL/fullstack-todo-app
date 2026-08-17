# Skill Creator (Meta-Skill)

## 1. Purpose & Responsibilities
- Standardize the creation, formatting, and refinement of all new skills/directives within the repository.
- Ensure every generated skill is deterministic, token-efficient, modular, and directly actionable by AI agents without ambiguous prose.

## 2. Standard Skill Template Structure
Setiap kali diminta membuat skill baru, Agent WAJIB mengikuti format Markdown berikut:

```markdown
# [Nama Skill]

## 1. Context & Scope
- [Tujuan utama skill dan batas lingkup penerapannya]
- [Kondisi kapan skill ini HARUS diaktifkan/dijalankan]

## 2. Core Operational Rules (Deterministic Instructions)
- [Aturan absolut, do's and don'ts]
- [Format data, naming conventions, atau token desain yang wajib dipatuhi]

## 3. Step-by-Step Execution Flow
1. **[Langkah 1]**: [Instruksi spesifik/eksekusi script]
2. **[Langkah 2]**: [Validasi dan integrasi komponen]
3. **[Langkah 3]**: [Post-processing / cleanup]

## 4. Edge Cases & Error Recovery (Self-Annealing)
- **[Kondisi Error 1]**: [Cara menangani tanpa merusak komponen sekitar]
- **[Kondisi Error 2]**: [Fallback action atau log requirement]

## 5. Verification Checklist
- [ ] Linter passing (0 errors)
- [ ] Production build verified (`npm run build`)
- [ ] Zero dead code / unused variables
```
