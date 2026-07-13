import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSkillMarkdown,
  parseSkillFrontmatter,
} from "../src/server/domains/skills/adapters/skillFrontmatter.ts";

const pdbfixerSkill = `---
name: molclaw-pdbfixer
description: Repair a protein PDB file with PDBFixer: fix missing atoms/residues, add hydrogens.
---

# PDBFixer
`;

test("parseSkillFrontmatter recovers unquoted description colons", () => {
  const frontmatter = parseSkillFrontmatter(pdbfixerSkill);

  assert.equal(frontmatter.name, "molclaw-pdbfixer");
  assert.equal(
    frontmatter.description,
    "Repair a protein PDB file with PDBFixer: fix missing atoms/residues, add hydrogens."
  );
});

test("normalizeSkillMarkdown makes recovered frontmatter YAML-compatible", () => {
  const normalized = normalizeSkillMarkdown(pdbfixerSkill);
  const frontmatter = parseSkillFrontmatter(normalized);

  assert.notEqual(normalized, pdbfixerSkill);
  assert.equal(frontmatter.name, "molclaw-pdbfixer");
  assert.equal(
    frontmatter.description,
    "Repair a protein PDB file with PDBFixer: fix missing atoms/residues, add hydrogens."
  );
});
