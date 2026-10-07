'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  StatutoryRule,
  resolveStatutoryRule,
  resolveEffectiveStatutoryProfile,
  calculateProfessionalTax,
  evaluateEsiCoverage,
  evaluateEpfCoverage,
  calculateStatutoryDeductions,
  STATUTORY_CONFIG,
} = require('../src/services/payrollStatutoryService');

test('P1-B: Statutory Rule Effective-Dated Architecture & Parity Suite', async (t) => {
  let mongod;

  t.before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await StatutoryRule.init();
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  t.beforeEach(async () => {
    await StatutoryRule.deleteMany({});
  });

  await t.test('1. Baseline Parity: When DB has no rules, falls back 100% to frozen statutory defaults', async () => {
    const epfRule = await resolveStatutoryRule('EPF', { effectiveDate: new Date('2026-03-15') });
    assert.equal(epfRule.wageCeilingPaise, STATUTORY_CONFIG.EPF.WAGE_CEILING_PAISA);
    assert.equal(epfRule.employeeRate, 0.12);

    const esiRule = await resolveStatutoryRule('ESI', { effectiveDate: new Date('2026-03-15') });
    assert.equal(esiRule.wageCeilingPaise, STATUTORY_CONFIG.ESI.STANDARD_WAGE_CEILING_PAISA);
    assert.equal(esiRule.employeeRate, 0.0075);

    // Evaluate deductions without DB rules: matches frozen calculation
    const deductions = calculateStatutoryDeductions({
      basicPayPaise: 1800000, // ₹18,000 (> ₹15,000 cap)
      grossPayPaise: 2000000, // ₹20,000 (<= ₹21,000 ESI cap)
      overtimePayPaise: 0,
      state: 'Kerala',
    });

    // EPF capped at 15k -> 12% of 15k = 1,800 INR = 180000 paise
    assert.equal(deductions.epf.epfBasePaise, 1500000);
    assert.equal(deductions.epf.employeeContributionPaise, 180000);
    // ESI on 20k -> 0.75% of 20k = 150 INR = 15000 paise
    assert.equal(deductions.esi.isCovered, true);
    assert.equal(deductions.esi.employeeContributionPaise, 15000);
    // Kerala PT on 20k -> slab ₹18k-₹29,999 is ₹180 = 18000 paise
    assert.equal(deductions.professionalTaxPaise, 18000);
  });

  await t.test('2. Effective-Dated Resolution: March 2026 payroll uses historical rule; July 2026 uses revised ceiling', async () => {
    // Rule 1: Effective until 2026-05-31 (Ceiling ₹15k)
    await StatutoryRule.create({
      ruleType: 'EPF',
      jurisdiction: 'ALL_INDIA',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-05-31T23:59:59.999Z'),
      employeeRate: 0.12,
      employerRate: 0.12,
      wageCeilingPaise: 1500000,
      configuration: {
        employerPfRate: 0.0367,
        employerEpsRate: 0.0833,
        epsMaxContributionPaise: 125000,
        epsMaxAge: 58,
      },
      version: 1,
      sourceReference: 'EPFO Notification 2020/01',
      isActive: true,
    });

    // Rule 2: Effective from 2026-06-01 onwards (Revised ceiling to ₹21k)
    await StatutoryRule.create({
      ruleType: 'EPF',
      jurisdiction: 'ALL_INDIA',
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      effectiveTo: null,
      employeeRate: 0.12,
      employerRate: 0.12,
      wageCeilingPaise: 2100000,
      configuration: {
        employerPfRate: 0.0367,
        employerEpsRate: 0.0833,
        epsMaxContributionPaise: 175000,
        epsMaxAge: 58,
      },
      version: 2,
      sourceReference: 'EPFO Gazette Notification 2026/GSR-42',
      isActive: true,
    });

    // Resolve March 2026
    const marchProfile = await resolveEffectiveStatutoryProfile({
      effectiveDate: new Date('2026-03-15T00:00:00.000Z'),
    });
    assert.equal(marchProfile.epfRule.wageCeilingPaise, 1500000);
    assert.equal(marchProfile.epfRule.version, 1);

    // Resolve July 2026
    const julyProfile = await resolveEffectiveStatutoryProfile({
      effectiveDate: new Date('2026-07-15T00:00:00.000Z'),
    });
    assert.equal(julyProfile.epfRule.wageCeilingPaise, 2100000);
    assert.equal(julyProfile.epfRule.version, 2);

    // Compute for employee with basic ₹18,000 in March 2026: capped at ₹15,000 -> PF ₹1,800
    const marchDeduction = calculateStatutoryDeductions({
      basicPayPaise: 1800000,
      grossPayPaise: 1800000,
      statutoryProfile: marchProfile,
    });
    assert.equal(marchDeduction.epf.epfBasePaise, 1500000);
    assert.equal(marchDeduction.epf.employeeContributionPaise, 180000);

    // Compute for same employee with basic ₹18,000 in July 2026: capped at ₹21,000 -> full ₹18,000 base -> PF ₹2,160
    const julyDeduction = calculateStatutoryDeductions({
      basicPayPaise: 1800000,
      grossPayPaise: 1800000,
      statutoryProfile: julyProfile,
    });
    assert.equal(julyDeduction.epf.epfBasePaise, 1800000);
    assert.equal(julyDeduction.epf.employeeContributionPaise, 216000);
  });

  await t.test('3. Custom State Professional Tax slab resolution via StatutoryRule', async () => {
    // Configure Maharashtra PT rule
    await StatutoryRule.create({
      ruleType: 'PROFESSIONAL_TAX',
      jurisdiction: 'MAHARASHTRA',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      configuration: {
        slabs: [
          { minPaise: 0, maxPaise: 750000, taxPaise: 0 },
          { minPaise: 750001, maxPaise: 1000000, taxPaise: 17500 },
          { minPaise: 1000001, maxPaise: Infinity, taxPaise: 20000 },
        ],
      },
      version: 1,
      sourceReference: 'Maharashtra State Tax on Professions Act',
      isActive: true,
    });

    const ptRule = await resolveStatutoryRule('PROFESSIONAL_TAX', {
      jurisdiction: 'MAHARASHTRA',
      effectiveDate: new Date('2026-04-01'),
    });
    assert.ok(ptRule);

    const taxBelow7500 = calculateProfessionalTax(700000, 'Maharashtra', { effectiveRule: ptRule });
    assert.equal(taxBelow7500, 0);

    const taxAt8500 = calculateProfessionalTax(850000, 'Maharashtra', { effectiveRule: ptRule });
    assert.equal(taxAt8500, 17500);

    const taxAbove10000 = calculateProfessionalTax(1500000, 'Maharashtra', { effectiveRule: ptRule });
    assert.equal(taxAbove10000, 20000);
  });

  await t.test('4. Inactive and out-of-date rules are strictly disregarded', async () => {
    await StatutoryRule.create({
      ruleType: 'ESI',
      jurisdiction: 'ALL_INDIA',
      effectiveFrom: new Date('2025-01-01'),
      effectiveTo: new Date('2025-12-31'),
      employeeRate: 0.005, // 0.5% in 2025
      wageCeilingPaise: 3000000,
      isActive: true,
    });

    await StatutoryRule.create({
      ruleType: 'ESI',
      jurisdiction: 'ALL_INDIA',
      effectiveFrom: new Date('2026-01-01'),
      employeeRate: 0.02, // 2% but inactive draft
      wageCeilingPaise: 5000000,
      isActive: false,
    });

    // Resolving for 2026-03-01 should not match 2025 rule (expired) nor inactive rule,
    // so it cleanly falls back to statutory default (0.75%, ₹21,000)
    const resolvedRule = await resolveStatutoryRule('ESI', {
      jurisdiction: 'ALL_INDIA',
      effectiveDate: new Date('2026-03-01'),
    });

    assert.equal(resolvedRule.wageCeilingPaise, 2100000);
    assert.equal(resolvedRule.employeeRate, 0.0075);
  });

  await t.test('5. Baseline Seeding utility establishes default rules when empty', async () => {
    const seeded = await StatutoryRule.seedBaselineRules();
    assert.equal(seeded.length, 4); // EPF, ESI, KERALA_PT, KARNATAKA_PT

    const epfCount = await StatutoryRule.countDocuments({ ruleType: 'EPF' });
    assert.equal(epfCount, 1);

    // Running seed again is idempotent (total count stays 4, no duplicates)
    await StatutoryRule.seedBaselineRules();
    const totalCount = await StatutoryRule.countDocuments();
    assert.equal(totalCount, 4);
  });
});
